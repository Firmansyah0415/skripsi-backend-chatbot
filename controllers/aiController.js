const model = require('../config/gemini');
const db = require('../config/firebaseConfig');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const generateWithFallback = async (prompt) => {
    try {
        return await model.generateContent(prompt);
    } catch (error) {
        const isOverloaded = error.status === 503 ||
            error.message.includes('503') ||
            error.message.includes('high demand') ||
            error.message.includes('Quota exceeded');

        if (isOverloaded) {
            console.warn("⚠️ Server Gemini Utama Penuh! Mengalihkan ke Model Cadangan (gemini-1.5-flash)...");
            try {
                const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
                const genAI = new GoogleGenerativeAI(apiKey);
                const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                return await fallbackModel.generateContent(prompt);
            } catch (fallbackError) {
                throw fallbackError;
            }
        }
        throw error;
    }
};

// --- FUNGSI SABUK PENGAMAN (Otomatis Tambah 1 Jam jika end_time kosong) ---
const addOneHour = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return timeStr || '';
    let [h, m] = timeStr.split(':');
    let hour = (parseInt(h, 10) + 1) % 24;
    return `${hour.toString().padStart(2, '0')}:${m}`;
};

// ============================================================================
// 1. HELPER FORMATTER 
// ============================================================================
const formatTeaching = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal mengajar)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        text += `[ID_DB: ${doc.id}] Matkul: "${data.course_name}". Hari: ${data.day_of_week}. Jam: ${data.start_time}-${data.end_time}. Ruang: ${data.classroom}.\n`;
    });
    return text;
};

const formatEvents = (docs) => {
    if (docs.empty) return "- (Tidak ada acara)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        // PERBAIKAN: Menambahkan end_time ke konteks baca AI
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". Tanggal: ${data.date}. Jam: ${data.time}-${data.end_time || ''}. Lokasi: ${data.location}. IsCompleted: ${data.is_completed}.\n`;
    });
    return text;
};

const formatTasks = (docs) => {
    if (docs.empty) return "- (Tidak ada tugas)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        // PERBAIKAN: Menambahkan end_time ke konteks baca AI
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". DeadlineTanggal: ${data.date}. Jam: ${data.time}-${data.end_time || ''}. IsCompleted: ${data.is_completed}.\n`;
    });
    return text;
};

const formatConsultations = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal sesi bimbingan)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". Tanggal: ${data.date}. Jam: ${data.start_time}-${data.end_time}. Status: ${data.status}.\n`;
    });
    return text;
};

// ============================================================================
// 2. FUNGSI READ (MEMBACA JADWAL)
// ============================================================================
const processReadSchedule = async (res, message, finalName, formattedNow, contextData) => {
    const prompt = `
        Kamu adalah asisten dosen bernama "Lecturo Assistant".
        
        DATA KONTEKS:
        - Waktu Saat Ini: ${formattedNow}
        - Nama User: ${finalName}

        ${contextData}

        ATURAN FORMATTING:
        1. Gunakan Header Kategori (Hanya jika ada datanya):
           - Tugas = 📝 **DAFTAR TUGAS**
           - Event = 🗓️ **ACARA / AGENDA**
           - Mengajar = 👨‍🏫 **JADWAL MENGAJAR**
           - Konsultasi = 🎓 **JADWAL SESI BIMBINGAN**
        
        2. Format Tampilan Per Item (Jangan tampilkan ID_DB, sembunyikan ID_DB dari user):
           - Judul harus di-Bold (*Judul*).
           - Baris Metadata: 🔴 [Prioritas] | [Status Emoticon] [Status Teks]
           - Baris Waktu: 📅 [Tanggal] ⏰ [Jam Mulai] - [Jam Selesai]
           - Baris Lokasi (Jika ada): 📍 [Lokasi]

        ATURAN LOGIKA STATUS & EMOTIKON (PENTING):
        Cek field 'IsCompleted' dan Bandingkan Waktu Jadwal dengan 'Waktu Saat Ini':
        - Status: Selesai (IsCompleted = true) -> Gunakan emot ✅ [Selesai].
        - Status: Belum Selesai TAPI Waktu Jadwal > Waktu Saat Ini -> Gunakan emot ⏳ [Upcoming].
        - Status: Belum Selesai DAN Waktu Jadwal < Waktu Saat Ini (Kadaluarsa) -> Gunakan emot ⛔ [Terlewat].

        ATURAN PRIORITAS:
        - High/Tinggi = 🔴 Tinggi
        - Medium/Sedang = 🟡 Sedang
        - Low/Rendah = 🟢 Rendah

        CONTOH FORMAT OUTPUT:
        🎓 **JADWAL BIMBINGAN**
        1. *Bimbingan Skripsi & KP*
           🔴 Tinggi | ⏳ Upcoming
           📅 20/02/2026 ⏰ 09:00 - 12:00
           📍 Lab RPL

        INSTRUKSI RESPON:
        - Jawab pertanyaan user: "${message}" secara sopan, ringkas dan to the point.
        - Jika user bertanya jadwal, tampilkan list sesuai format compact di atas.
        - Jangan tampilkan deskripsi/catatan panjang agar chat tidak penuh.
        - Jangan pernah menampilkan ID_DB ke hadapan user.
    `;

    const result = await generateWithFallback(prompt);
    const response = await result.response;
    const textReply = response.text();
    const brandedReply = `${textReply}\n\n🤖 *Lecturo Assistant*`;

    return res.json({ status: 'success', reply: brandedReply });
};

// ============================================================================
// 3. FUNGSI CREATE (MENAMBAH JADWAL BARU - DENGAN VALIDASI PINTAR)
// ============================================================================
const processCreateSchedule = async (res, userRef, message, formattedNow) => {
    const prompt = `
    WAKTU SAAT INI (SERVER): ${formattedNow}
    
    Ekstrak pesan ini untuk membuat jadwal baru: "${message}"
    
    Wajib kembalikan format JSON murni (tanpa markdown).
    {
      "is_data_complete": true atau false,
      "collection": "tasks" ATAU "events" ATAU "teaching_schedules" ATAU "consultations" ATAU "none",
      "data": {
        // isi sesuai kebutuhan struktur di bawah
      },
      "reply": "Teks balasan untuk user."
    }

    ATURAN VALIDASI (SANGAT PENTING):
    - Hitung tanggal secara akurat berdasarkan WAKTU SAAT INI (${formattedNow}).
    - JANGAN PERNAH MENGGUNAKAN TANGGAL DI MASA LALU. Selalu gunakan tahun berjalan (2026 atau lebih).
    - Jika user bertanya panduan, jelaskan cara pakai bot secara singkat.
    - Untuk membuat jadwal, user WAJIB minimal menyebutkan: JUDUL (Title) dan WAKTU (Tanggal/Jam).
    - Jika "is_data_complete" false, isi "reply" dengan pertanyaan meminta data yang kurang.
    - Jika "is_data_complete" true, isi "data" dengan:
      > tasks: title, date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority (Tinggi/Sedang/Rendah), location, description.
      > events: title, category (Rapat/Seminar/Lainnya), date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority, location, description.
      > consultations: title, date (DD/MM/YYYY), start_time, end_time, location, description, status ("SCHEDULED").
      > teaching_schedules: course_name, day_of_week, start_time, end_time, classroom.

    ATURAN PENGISIAN FIELD KOSONG (WAJIB):
    Jika user tidak menyebutkan lokasi atau deskripsi, KAMU WAJIB MENGISINYA DENGAN STRING KOSONG "".
    Jika user tidak menyebutkan waktu selesai (end_time), KAMU WAJIB MENGISINYA dengan estimasi 1 jam setelah jam mulai (time).
    JANGAN PERNAH menggunakan null, dan JANGAN PERNAH menghilangkan atribut tersebut dari JSON!
    `;

    const result = await generateWithFallback(prompt);
    let cleanJson = (await result.response).text().replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);

        if (aiData.is_data_complete === true && aiData.collection !== 'none') {

            // --- 🛡️ SABUK PENGAMAN (SANITIZER) ---
            const sanitizedData = {};
            for (const key in aiData.data) {
                sanitizedData[key] = (aiData.data[key] === null || aiData.data[key] === undefined) ? "" : aiData.data[key];
            }

            if (!('description' in sanitizedData)) sanitizedData.description = "";
            if (!('location' in sanitizedData)) sanitizedData.location = "";

            // PERBAIKAN: Sabuk pengaman ganda jika AI lupa memberi end_time
            if (!('end_time' in sanitizedData) || sanitizedData.end_time === "") {
                sanitizedData.end_time = addOneHour(sanitizedData.time || "");
            }

            const finalData = {
                ...sanitizedData,
                input_source: 'WA_BOT',
                updated_at: new Date().toISOString(),
                is_completed: false,
                notification_minutes: 15
            };

            await userRef.collection(aiData.collection).add(finalData);
            return res.json({ status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` });
        }
        else {
            return res.json({ status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` });
        }

    } catch (e) {
        console.error("Gagal parse Create:", e);
        return res.json({ status: 'error', reply: "Maaf, format jadwal tidak dapat saya pahami. Mohon sebutkan nama acara dan waktunya dengan jelas.\n\n🤖 *Lecturo Assistant*" });
    }
};

// ============================================================================
// 4. FUNGSI DELETE (KEMBALI KE HARD DELETE + ANTI HALUSINASI)
// ============================================================================
const processDeleteSchedule = async (res, userRef, message, contextData) => {
    // VARIABEL PROMPT DIKEMBALIKAN UTUH DI SINI
    const prompt = `
    Pesan user: "${message}"
    
    Berikut adalah jadwal user saat ini:
    ${contextData}

    Tugas: Cari tahu jadwal mana yang mau dihapus user dari data di atas.
    Wajib kembalikan format JSON murni:
    {
      "document_id": "ID_DB dari jadwal yang mau dihapus",
      "collection": "Koleksi jadwal tersebut (tasks / events / teaching_schedules / consultations)",
      "reply": "Teks konfirmasi penghapusan berhasil."
    }
    Jika jadwal tidak ditemukan, JANGAN buat konfirmasi berhasil. Kosongkan document_id dan isi reply dengan permintaan maaf.
    `;

    const result = await generateWithFallback(prompt);
    let cleanJson = (await result.response).text().replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);

        if (aiData.document_id && aiData.document_id.trim() !== "") {
            // PERBAIKAN: Kembali gunakan HARD DELETE agar tidak ada sampah di Firestore
            await userRef.collection(aiData.collection).doc(aiData.document_id).delete();
            return res.json({ status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` });
        } else {
            return res.json({
                status: 'success',
                reply: "Maaf, saya tidak dapat menemukan jadwal tersebut di database. Pastikan nama jadwalnya sesuai.\n\n🤖 *Lecturo Assistant*"
            });
        }
    } catch (e) {
        console.error("Gagal parse Delete:", e);
        return res.json({ status: 'error', reply: "Maaf, saya gagal memproses permintaan hapus Anda.\n\n🤖 *Lecturo Assistant*" });
    }
};

// ============================================================================
// 5. ORKESTRATOR (GERBANG UTAMA CHATBOT)
// ============================================================================
const chatWithGemini = async (req, res) => {
    try {
        const { message, uid, userName } = req.body;
        if (!message || !uid) return res.status(400).json({ error: 'Data tidak lengkap' });

        const finalName = userName || "Dosen";
        const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Makassar',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        let formattedNow = formatter.format(new Date());
        formattedNow = formattedNow.replace(/\./g, ':');

        const userRef = db.collection('users').doc(uid);

        const [teachingSnap, eventSnap, taskSnap, consultationSnap] = await Promise.all([
            userRef.collection('teaching_schedules').get(),
            userRef.collection('events').get(),
            userRef.collection('tasks').get(),
            userRef.collection('consultations').get()
        ]);

        const contextData = `
        A. JADWAL MENGAJAR:\n${formatTeaching(teachingSnap)}
        B. EVENT / ACARA:\n${formatEvents(eventSnap)}
        C. TUGAS / TASKS:\n${formatTasks(taskSnap)}
        D. KONSULTASI:\n${formatConsultations(consultationSnap)}
        `;

        const intentPrompt = `Pesan user: "${message}". Apakah tujuan user? 
        Jawab HANYA DENGAN SATU KATA: "CREATE" (jika ingin menambah jadwal), "DELETE" (jika ingin menghapus/membatalkan jadwal), atau "READ" (jika bertanya, menyapa, atau melihat jadwal).`;

        const intentResult = await generateWithFallback(intentPrompt);
        const intentText = (await intentResult.response).text().toUpperCase();

        console.log(`🤖 Intent Deteksi: ${intentText}`);

        if (intentText.includes('CREATE')) {
            return await processCreateSchedule(res, userRef, message, formattedNow);
        }
        else if (intentText.includes('DELETE')) {
            return await processDeleteSchedule(res, userRef, message, contextData);
        }
        else {
            return await processReadSchedule(res, message, finalName, formattedNow, contextData);
        }

    } catch (error) {
        console.error("Error Chat AI:", error.message);
        if (error.status === 429 || error.message.includes('Quota exceeded')) {
            return res.json({ status: 'success', reply: "⚠️ *Server Sibuk*\n\nMohon tunggu sebentar.\n\n🤖 *Lecturo System*" });
        }
        return res.json({ status: 'success', reply: "⚠️ *Terjadi Kesalahan*\n\nMaaf, saya gagal memuat data Anda." });
    }
};

// ============================================================================
// FUNGSI OCR (EKSTRAKSI EVENT DARI GAMBAR/PDF)
// ============================================================================
const extractEvent = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Teks input kosong' });

        const prompt = `
        Analisis teks berikut untuk jadwal acara/akademik. Ekstrak ke format JSON murni:
        - "title": Judul acara.
        - "category": "Rapat, Seminar, Webinar, Workshop, Penelitian, atau Lainnya".
        - "date": format "DD/MM/YYYY".
        - "time": Waktu mulai (format "HH:mm"). Jika teks memiliki rentang (contoh: "19.00 - 21.00"), maka ini adalah "19:00".
        - "end_time": Waktu selesai (format "HH:mm"). Jika teks memiliki rentang (contoh: "19.00 - 21.00" atau "19:00 s.d 21:00"), AMBIL NILAI AKHIRNYA (berarti "21:00"). Jika benar-benar tidak ada indikasi waktu selesai, WAJIB isi dengan estimasi 1 jam setelah waktu mulai.
        - "location": Lokasi acara.
        - "description": Ringkasan atau informasi tambahan.

        Aturan Ekstraksi: 
        1. Isi string kosong "" jika data tidak ada, jangan gunakan null.
        2. Abaikan zona waktu seperti WITA/WIB, cukup ambil angkanya.
        3. Hanya return JSON murni tanpa markdown \`\`\`json.

        Teks: "${text}"
        `;

        const result = await generateWithFallback(prompt);
        const response = await result.response;
        let cleanJson = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

        const eventData = JSON.parse(cleanJson);
        res.json({ status: 'success', data: eventData });

    } catch (error) {
        console.error("Error Extract Event:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mengekstrak event.', error_details: error.message });
    }
};

module.exports = { chatWithGemini, extractEvent };