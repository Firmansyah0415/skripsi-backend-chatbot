const model = require('../config/gemini');
const db = require('../config/firebaseConfig');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================================================
// FUNGSI GEMINI (ASLI) - DIKOMENTARI SAAT TES LM STUDIO
// ============================================================================
/*
const generateWithFallback = async (prompt) => {
    try {
        // 1. Coba ketuk pintu utama (gemini-2.5-flash dari config/gemini.js)
        return await model.generateContent(prompt);
    } catch (error) {
        // 2. Jika pintu utama penuh atau kena limit (Error 503 / 429)
        const isOverloaded = error.status === 503 || error.status === 429 ||
            error.message.includes('503') || error.message.includes('429') ||
            error.message.includes('high demand') || error.message.includes('Quota exceeded');

        if (isOverloaded) {
            console.warn("⚠️ Server Gemini Utama Penuh! Mengalihkan ke Model Cadangan (gemini-2.0-flash)...");
            try {
                // Gunakan API Key yang ada
                const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
                const genAI = new GoogleGenerativeAI(apiKey);

                // 3. Ketuk pintu cadangan yang BERBEDA agar tidak bertabrakan dengan antrean pintu utama
                const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

                return await fallbackModel.generateContent(prompt);
            } catch (fallbackError) {
                // Jika pintu cadangan juga ikut penuh, lempar error ke bawah
                throw fallbackError;
            }
        }

        // Lempar error jika bukan karena masalah server penuh (misal: internet putus)
        throw error;
    }
};
*/

// ============================================================================
// FUNGSI LM STUDIO (LOCAL AI) - UPDATE DENGAN ANTI-THINK FILTER
// ============================================================================
const generateWithFallback = async (prompt) => {
    try {
        console.log("🤖 Menghubungi LM Studio Local Server...");
        const response = await fetch('https://diego-beaky-unappeasably.ngrok-free.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                model: "local-model",
                messages: [
                    { role: "system", content: "Kamu adalah asisten akademik bernama Lecturo Assistant. Jawab dengan ringkas, sopan, dan sesuai instruksi tanpa basa-basi." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: -1
            })
        });

        if (!response.ok) {
            throw new Error(`LM Studio Error: ${response.statusText}`);
        }

        const data = await response.json();
        let aiResponseText = data.choices[0].message.content;

        // =====================================================================
        // 🔥 BARIS SAKTI BARU: SAPU BERSIH TAG <THINK>...</THINK> beserta isinya!
        // =====================================================================
        aiResponseText = aiResponseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        // =====================================================================

        // BUNGKUS JAWABAN LM STUDIO AGAR TERLIHAT SEPERTI FORMAT GEMINI
        return {
            response: {
                text: () => aiResponseText
            }
        };

    } catch (error) {
        console.error("⚠️ Gagal menghubungi AI (LM Studio):", error);
        throw error;
    }
};
// ============================================================================


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
        text += `[ID_DB: ${doc.id}] Matkul: "${data.course_name}" (Pertemuan ke-${data.meeting_number}). Tanggal: ${data.date} (${data.day_of_week}). Jam: ${data.start_time}-${data.end_time}. Ruang: ${data.classroom}. Selesai: ${data.is_completed}. Prioritas: Tinggi.\n`;
    });
    return text;
};

const formatEvents = (docs) => {
    if (docs.empty) return "- (Tidak ada acara)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". Tanggal: ${data.date}. Jam: ${data.time}-${data.end_time || ''}. Lokasi: ${data.location}. IsCompleted: ${data.is_completed}. Prioritas: ${data.priority || 'Sedang'}.\n`;
    });
    return text;
};

const formatTasks = (docs) => {
    if (docs.empty) return "- (Tidak ada tugas)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". DeadlineTanggal: ${data.date}. Jam: ${data.time}-${data.end_time || ''}. IsCompleted: ${data.is_completed}. Prioritas: ${data.priority || 'Sedang'}.\n`;
    });
    return text;
};

const formatConsultations = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal sesi bimbingan)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        text += `[ID_DB: ${doc.id}] Judul: "${data.title}". Tanggal: ${data.date}. Jam: ${data.start_time}-${data.end_time}. Status: ${data.status}. Prioritas: ${data.priority || 'Sedang'}.\n`;
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
           - Baris Metadata: 🔴/🟡/🟢 [Prioritas] | [Status Emoticon] [Status Teks]
           - Baris Waktu: 📅 [Tanggal] ⏰ [Jam Mulai] - [Jam Selesai]
           - Baris Lokasi (Jika ada): 📍 [Lokasi]

        ATURAN LOGIKA STATUS & EMOTIKON (PENTING):
        Cek field 'IsCompleted' (Atau 'Status' untuk Konsultasi) dan Bandingkan Waktu Jadwal dengan 'Waktu Saat Ini':
        - Jika IsCompleted = true ATAU Status = COMPLETED -> ✅ [Selesai].
        - Jika IsCompleted = false ATAU Status = SCHEDULED -> ⏳ [Upcoming] (Jika jadwal belum lewat) ATAU ⛔ [Terlewat] (Jika waktu sudah kadaluarsa).

        ATURAN PRIORITAS (WAJIB IKUTI WARNA INI SAJA):
        - Jika prioritas bertuliskan "Tinggi" atau "High" -> Gunakan 🔴 Tinggi
        - Jika prioritas bertuliskan "Sedang", "Medium", ATAU KOSONG -> Gunakan 🟡 Sedang
        - Jika prioritas bertuliskan "Rendah" atau "Low" -> Gunakan 🟢 Rendah

        CONTOH FORMAT OUTPUT:
        🎓 **JADWAL BIMBINGAN**
        1. *Bimbingan Skripsi & KP*
           🟡 Sedang | ⏳ Upcoming
           📅 20/02/2026 ⏰ 09:00 - 12:00
           📍 Lab RPL

        INSTRUKSI RESPON:
        - Jawab pertanyaan user: "${message}" secara sopan, ringkas dan to the point.
        - Jika user bertanya jadwal, tampilkan list sesuai format compact di atas.
        - Jika user hanya menyapa, balas sapaannya dengan menyebut nama user, lalu tawarkan bantuan.
        - WAJIB TOLAK DENGAN SOPAN jika user menanyakan hal di luar konteks jadwal.
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
      "data": { ... },
      "reply": "Teks balasan untuk user."
    }

    ATURAN KOLEKSI (WAJIB DIIKUTI AGAR TIDAK SALAH KAMAR):
    - Jika user menyuruh buat "Tugas", WAJIB gunakan collection: "tasks". JANGAN gunakan teaching_schedules.
    - Jika user menyuruh buat "Mengajar" atau "Kuliah", WAJIB gunakan collection: "teaching_schedules".
    - Jika user menyuruh buat "Konsultasi" atau "Bimbingan", WAJIB gunakan collection: "consultations".
    - Jika user menyuruh buat "Acara", "Event", atau "Rapat", WAJIB gunakan collection: "events".

    ATURAN TANGGAL & WAKTU:
    - Hitung tanggal secara akurat berdasarkan WAKTU SAAT INI (${formattedNow}). Jika user bilang "besok", tambahkan 1 hari ke tanggal saat ini.
    - JANGAN PERNAH MENGGUNAKAN TANGGAL DI MASA LALU.

    FORMAT PENGISIAN FIELD "data":
    > tasks: title, date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority (Tinggi/Sedang/Rendah), location, description.
    > events: title, category (Rapat/Seminar/Lainnya), date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority, location, description.
    > consultations: title, date (DD/MM/YYYY), start_time (HH:mm), end_time (HH:mm), priority, location, description.
    > teaching_schedules: course_name, class_code, day_of_week, date (DD/MM/YYYY), start_time (HH:mm), end_time (HH:mm), classroom, meeting_number (isi dengan angka 1), student_count (isi dengan angka 0).
    `;

    const result = await generateWithFallback(prompt);
    let cleanJson = (await result.response).text().replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);

        if (aiData.is_data_complete === true && aiData.collection !== 'none') {

            const sanitizedData = {};
            for (const key in aiData.data) {
                sanitizedData[key] = (aiData.data[key] === null || aiData.data[key] === undefined) ? "" : aiData.data[key];
            }

            if (!('description' in sanitizedData)) sanitizedData.description = "";
            // 🔴 PERBAIKAN BUG LOKASI/CLASSROOM KOSONG
            if (aiData.collection === 'teaching_schedules') {
                if (!('classroom' in sanitizedData)) sanitizedData.classroom = "";
            } else {
                if (!('location' in sanitizedData)) sanitizedData.location = "";
            }
            if (!('end_time' in sanitizedData) || sanitizedData.end_time === "") {
                const startTimeToUse = sanitizedData.time || sanitizedData.start_time || "08:00";
                sanitizedData.end_time = addOneHour(startTimeToUse);
            }

            // 🟡 PERBAIKAN: Default Priority jika kosong atau aneh
            if (!sanitizedData.priority || sanitizedData.priority === "") {
                sanitizedData.priority = "Sedang";
            } else {
                const p = sanitizedData.priority.toLowerCase();
                if (['tinggi', 'high', 'urgent'].includes(p)) sanitizedData.priority = "Tinggi";
                else if (['rendah', 'low', 'santai'].includes(p)) sanitizedData.priority = "Rendah";
                else sanitizedData.priority = "Sedang";
            }

            // PAYLOAD STANDAR
            const finalData = {
                ...sanitizedData,
                input_source: 'WA_BOT',
                updated_at: new Date().toISOString(),
                notification_minutes: 15
            };

            // 🎯 FILTER KOLEKSI SPESIFIK
            if (aiData.collection === 'consultations') {
                finalData.status = 'SCHEDULED';
                finalData.recurring_id = "";
                delete finalData.is_completed; // Mencegah is_completed masuk ke DB
            }
            // =======================================================
            // 🔴 GANTI BLOK TEACHING_SCHEDULES INI SAJA
            // =======================================================
            else if (aiData.collection === 'teaching_schedules') {
                finalData.is_completed = false;
                finalData.meeting_number = parseInt(sanitizedData.meeting_number) || 1;

                // 1. Pastikan student_count diisi 0 jika gagal di-parse atau tidak ada
                finalData.student_count = parseInt(sanitizedData.student_count) || 0;

                // 2. Pastikan classroom string kosong ("") jika user tidak menyebutkan lokasi
                finalData.classroom = sanitizedData.classroom || "";

                if (!finalData.class_code) finalData.class_code = "-";

                // 3. HAPUS PAKSA description dan priority agar sama persis dengan Android & Web!
                delete finalData.description;
                delete finalData.priority;
            }
            // =======================================================
            else {
                finalData.is_completed = false;
            }

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

        const userSnap = await userRef.get();
        const userData = userSnap.data() || {};
        const gender = userData.gender || "";

        let panggilan = "";
        if (gender.toLowerCase() === "laki-laki") {
            panggilan = "Bapak";
        } else if (gender.toLowerCase() === "perempuan") {
            panggilan = "Ibu";
        }

        const finalName = userName || "Dosen";
        const finalNameWithTitle = panggilan ? `${panggilan} ${finalName}` : finalName;

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

        const intentPrompt = `Pesan user: "${message}". Apakah tujuan utama user? 
        Pilih HANYA SATU KATA dari daftar berikut:
        - "CREATE" (jika ingin menambah/membuat jadwal baru)
        - "DELETE" (jika ingin menghapus/membatalkan jadwal)
        - "READ" (jika menanyakan jadwal, meminta ringkasan, atau sekadar menyapa/salam)
        - "OUT_OF_SCOPE" (jika bertanya hal di luar jadwal akademik, seperti matematika, coding, pengetahuan umum, cuaca, dll).
        Jawab HANYA DENGAN SATU KATA tersebut tanpa tambahan apapun!`;

        const intentResult = await generateWithFallback(intentPrompt);
        const intentText = (await intentResult.response).text().toUpperCase();

        console.log(`🤖 Intent Deteksi: ${intentText} | User: ${finalNameWithTitle}`);

        if (intentText.includes('CREATE')) {
            return await processCreateSchedule(res, userRef, message, formattedNow);
        }
        else if (intentText.includes('DELETE')) {
            return await processDeleteSchedule(res, userRef, message, contextData);
        }
        else if (intentText.includes('OUT_OF_SCOPE') || intentText.includes('SCOPE')) {
            return res.json({
                status: 'success',
                reply: `Maaf ${finalNameWithTitle}, saya adalah asisten yang dirancang khusus hanya untuk mengelola jadwal akademik Anda. Saya tidak dapat menjawab pertanyaan terkait hal tersebut. 🙏\n\nSilakan tanyakan seputar jadwal mengajar, acara, tugas, atau bimbingan Anda.\n\n🤖 *Lecturo Assistant*`
            });
        }
        else {
            return await processReadSchedule(res, message, finalNameWithTitle, formattedNow, contextData);
        }

    } catch (error) {
        console.error("Error Chat AI:", error.message);

        const isBusy = error.status === 429 || error.status === 503 ||
            error.message.includes('Quota') || error.message.includes('429') ||
            error.message.includes('503');

        if (isBusy) {
            const namaSapaan = typeof finalNameWithTitle !== 'undefined' ? finalNameWithTitle : "Bapak/Ibu";

            return res.json({
                status: 'success',
                reply: `⚠️ *Sistem Sedang Sibuk*\n\nMaaf ${namaSapaan}, layanan AI sedang menangani banyak permintaan. Mohon tunggu sekitar 1 menit lalu coba kirimkan pesan Anda lagi. 🙏\n\n🤖 *Lecturo System*`
            });
        }

        return res.json({
            status: 'success',
            reply: "⚠️ *Terjadi Kesalahan*\n\nMaaf, saya gagal memproses permintaan Anda saat ini."
        });
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