const db = require('../config/firebaseConfig');

// ============================================================================
// SISTEM HYBRID FAILOVER: LM STUDIO (UTAMA) -> OPENROUTER (CADANGAN OTOMATIS)
// ============================================================================
const generateWithFallback = async (prompt) => {
    // ------------------------------------------------------------------------
    // TAHAP 1: COBA KETUK PINTU UTAMA (LM STUDIO LOKAL)
    // ------------------------------------------------------------------------
    try {
        console.log("🤖 [1/2] Menghubungi LM Studio Local Server...");

        // Sabuk pengaman: batas waktu tunggu 4 detik agar bot tidak bengong jika laptop mati
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch('https://diego-beaky-unappeasably.ngrok-free.dev/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
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

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`LM Studio HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        let aiResponseText = data.choices[0].message.content;
        aiResponseText = aiResponseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        console.log("✅ Berhasil dilayani oleh: LM Studio (Lokal)");
        return {
            response: {
                text: () => aiResponseText
            }
        };

    } catch (lmError) {
        // --------------------------------------------------------------------
        // TAHAP 2: JIKA LM STUDIO MATI/TIMEOUT, LEMPAR KE OPENROUTER (CLOUD)
        // --------------------------------------------------------------------
        console.warn(`⚠️ LM Studio tidak merespons (${lmError.message}). Mengalihkan ke OpenRouter...`);

        try {
            const apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) {
                throw new Error("OPENROUTER_API_KEY belum dipasang di file .env");
            }

            console.log("🌐 [2/2] Menghubungi OpenRouter (Cloud Backup)...");

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://lecturo.id',
                    'X-Title': 'Lecturo Assistant'
                },
                body: JSON.stringify({
                    models: [
                        "meta-llama/llama-3.3-70b-instruct:free",
                        "qwen/qwen-2.5-72b-instruct:free",
                        "meta-llama/llama-3.1-8b-instruct:free",
                        "mistralai/mistral-small-24b-instruct-2501:free"
                    ],
                    messages: [
                        {
                            role: "system",
                            content: "Kamu adalah asisten akademik bernama Lecturo Assistant. Jawab dengan ringkas, sopan, dan patuhi instruksi JSON atau teks yang diminta tanpa basa-basi."
                        },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`OpenRouter HTTP ${response.status}: ${errorBody}`);
            }

            const data = await response.json();
            let aiResponseText = data.choices[0].message.content;
            aiResponseText = aiResponseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            console.log("✅ Berhasil dilayani oleh: OpenRouter Cloud");
            return {
                response: {
                    text: () => aiResponseText
                }
            };

        } catch (openRouterError) {
            console.error("❌ Kedua jalur AI (LM Studio & OpenRouter) gagal:", openRouterError.message);
            throw openRouterError;
        }
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
// 2. FUNGSI READ (ARSITEKTUR RAG: AI EKSTRAK TANGGAL + JS TEMPLATE STRING)
// ============================================================================
const processReadSchedule = async (res, userRef, message, finalName, formattedNow, todayStr, tomorrowStr) => {
    // FASE 1: EKSTRAKSI TANGGAL OLEH AI (Hanya 1x Panggilan AI)
    const queryPrompt = `
    Tanggal Hari Ini: ${todayStr}
    Tanggal Besok: ${tomorrowStr}

    Pesan user: "${message}"

    Tugas: Tentukan tanggal jadwal yang dicari user. Kembalikan HANYA JSON:
    {
        "target_date": "DD/MM/YYYY"
    }
    Jika user hanya menyapa atau tidak menyebut waktu, gunakan Tanggal Hari Ini.
    `;

    let targetDate = todayStr;
    try {
        const queryResult = await generateWithFallback(queryPrompt);
        let cleanJson = (await queryResult.response).text().replace(/```json/g, '').replace(/```/g, '').trim();
        const aiQuery = JSON.parse(cleanJson);
        if (aiQuery.target_date) targetDate = aiQuery.target_date;
    } catch (e) {
        console.warn("⚠️ Fallback ke tanggal hari ini:", e.message);
    }

    console.log(`🔍 [PENCARIAN DB] Mengambil jadwal tanggal: ${targetDate}`);

    // FASE 2: QUERY FIRESTORE
    const [teachingSnap, eventSnap, taskSnap, consultSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('date', '==', targetDate).get(),
        userRef.collection('events').where('date', '==', targetDate).get(),
        userRef.collection('tasks').where('date', '==', targetDate).get(),
        userRef.collection('consultations').where('date', '==', targetDate).get()
    ]);

    const isAllEmpty = teachingSnap.empty && eventSnap.empty && taskSnap.empty && consultSnap.empty;

    // FASE 3: GENERASI TAMPILAN MENGGUNAKAN JAVASCRIPT (Bebas Halusinasi & Instan)
    const formatPriority = (p) => {
        const val = (p || '').toLowerCase();
        if (val === 'tinggi') return '🔴 Tinggi';
        if (val === 'rendah') return '🟢 Rendah';
        return '🟡 Sedang';
    };

    const formatStatus = (isCompleted) => {
        return isCompleted ? '✅ Selesai' : '⏳ Upcoming';
    };

    // Sapaan pembuka
    let output = `Halo, *${finalName}*!\n`;

    if (isAllEmpty) {
        output += `Anda tidak memiliki agenda atau jadwal kegiatan untuk tanggal *${targetDate}*.`;
        return res.json({ status: 'success', reply: `${output}\n\n🤖 *Lecturo Assistant*` });
    }

    output += `Berikut adalah agenda Anda untuk tanggal *${targetDate}*:\n`;

    // 1. Jadwal Mengajar (Gunakan .docs.forEach agar idx terisi angka 0, 1, 2...)
    if (!teachingSnap.empty) {
        output += `\n👨‍🏫 *JADWAL MENGAJAR*`;
        teachingSnap.docs.forEach((doc, idx) => {
            const d = doc.data();
            output += `\n${idx + 1}. *${d.course_name}* (Pertemuan ke-${d.meeting_number || 1})`;
            output += `\n   🔴 Tinggi | ${formatStatus(d.is_completed)}`;
            output += `\n   📅 ${d.date} ⏰ ${d.start_time} - ${d.end_time}`;
            if (d.classroom && d.classroom !== '-') output += `\n   📍 Ruang: ${d.classroom}`;
        });
        output += `\n`;
    }

    // 2. Acara / Agenda
    if (!eventSnap.empty) {
        output += `\n🗓️ *ACARA / AGENDA*`;
        eventSnap.docs.forEach((doc, idx) => {
            const d = doc.data();
            output += `\n${idx + 1}. *${d.title}*`;
            output += `\n   ${formatPriority(d.priority)} | ${formatStatus(d.is_completed)}`;
            output += `\n   📅 ${d.date} ⏰ ${d.time} - ${d.end_time || '-'}`;
            if (d.location) output += `\n   📍 ${d.location}`;
        });
        output += `\n`;
    }

    // 3. Tugas / Tasks
    if (!taskSnap.empty) {
        output += `\n📝 *DAFTAR TUGAS*`;
        taskSnap.docs.forEach((doc, idx) => {
            const d = doc.data();
            output += `\n${idx + 1}. *${d.title}*`;
            output += `\n   ${formatPriority(d.priority)} | ${formatStatus(d.is_completed)}`;
            output += `\n   📅 Deadline: ${d.date} ⏰ ${d.time || '-'}`;
            if (d.location) output += `\n   📍 ${d.location}`;
        });
        output += `\n`;
    }

    // 4. Konsultasi / Bimbingan
    if (!consultSnap.empty) {
        output += `\n🎓 *JADWAL SESI BIMBINGAN*`;
        consultSnap.docs.forEach((doc, idx) => {
            const d = doc.data();
            const statusText = d.status === 'COMPLETED' ? '✅ Selesai' : '⏳ Terjadwal';
            output += `\n${idx + 1}. *${d.title}*`;
            output += `\n   ${formatPriority(d.priority)} | ${statusText}`;
            output += `\n   📅 ${d.date} ⏰ ${d.start_time} - ${d.end_time}`;
            if (d.location && d.location !== 'Belum ditentukan') output += `\n   📍 ${d.location}`;
        });
        output += `\n`;
    }

    return res.json({ status: 'success', reply: `${output.trim()}\n\n🤖 *Lecturo Assistant*` });
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
// 4. FUNGSI DELETE (Pindahkan pemanggilan DB ke sini agar tidak membebani fungsi lain)
// ============================================================================
const processDeleteSchedule = async (res, userRef, message) => {
    console.log(`🔍 [PENCARIAN DB] Mengambil jadwal aktif untuk dihapus...`);
    // Ambil jadwal yang belum selesai agar AI punya konteks apa yang mau dihapus
    const [teachingSnap, eventSnap, taskSnap, consultationSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('is_completed', '==', false).get(),
        userRef.collection('events').where('is_completed', '==', false).get(),
        userRef.collection('tasks').where('is_completed', '==', false).get(),
        userRef.collection('consultations').where('status', '==', 'SCHEDULED').get()
    ]);

    const contextData = `
    A. JADWAL MENGAJAR:\n${formatTeaching(teachingSnap)}
    B. EVENT / ACARA:\n${formatEvents(eventSnap)}
    C. TUGAS / TASKS:\n${formatTasks(taskSnap)}
    D. KONSULTASI:\n${formatConsultations(consultationSnap)}
    `;

    const prompt = `
    Pesan user: "${message}"
    Berikut jadwal aktif:
    ${contextData}

    Tugas: Cari ID jadwal yang mau dihapus. Wajib format JSON murni:
    {
      "document_id": "ID_DB",
      "collection": "koleksi (tasks/events/teaching_schedules/consultations)",
      "reply": "Pesan konfirmasi berhasil"
    }
    Kosongkan document_id jika tidak ketemu.
    `;

    const result = await generateWithFallback(prompt);
    let cleanJson = (await result.response).text().replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);
        if (aiData.document_id && aiData.document_id.trim() !== "") {
            await userRef.collection(aiData.collection).doc(aiData.document_id).delete();
            return res.json({ status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` });
        } else {
            return res.json({ status: 'success', reply: "Maaf, jadwal tersebut tidak ditemukan di database Anda.\n\n🤖 *Lecturo Assistant*" });
        }
    } catch (e) {
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
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        // Waktu server (Lengkap dengan jam)
        let formattedNow = formatter.format(new Date()).replace(/\./g, ':');
        // Tanggal murni (DD/MM/YYYY)
        const todayStr = formattedNow.split(' ')[0];

        // Kalkulasi akurat tanggal besok (agar AI tidak halusinasi hitung matematika kalender)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = formatter.format(tomorrow).split(' ')[0];

        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        const userData = userSnap.data() || {};
        const gender = userData.gender || "";

        let panggilan = gender.toLowerCase() === "laki-laki" ? "Bapak" : gender.toLowerCase() === "perempuan" ? "Ibu" : "";
        const finalName = userName || "Dosen";
        const finalNameWithTitle = panggilan ? `${panggilan} ${finalName}` : finalName;

        // FASE 0: ROUTING INTENT DENGAN INSTRUKSI LEBIH CERDAS
        const intentPrompt = `Pesan user: "${message}". Tujuan utama user? 
        Pilih HANYA SATU KATA dari daftar berikut:
        - CREATE : jika ingin menambah/membuat jadwal baru.
        - DELETE : jika ingin menghapus/membatalkan jadwal.
        - READ : jika menanyakan jadwal, atau sekadar menyapa/salam (contoh: "halo", "selamat pagi", "p", "assalamualaikum").
        - OUT_OF_SCOPE : jika bertanya hal di luar jadwal akademik (contoh: cuaca, matematika, coding, resep masakan).
        Jawab HANYA DENGAN SATU KATA tersebut tanpa tambahan apapun!`;

        const intentResult = await generateWithFallback(intentPrompt);
        const intentText = (await intentResult.response).text().toUpperCase();

        console.log(`🤖 Intent Deteksi: ${intentText} | User: ${finalNameWithTitle}`);

        if (intentText.includes('CREATE')) {
            return await processCreateSchedule(res, userRef, message, formattedNow);
        }
        else if (intentText.includes('DELETE')) {
            return await processDeleteSchedule(res, userRef, message);
        }
        else if (intentText.includes('OUT_OF_SCOPE') || intentText.includes('SCOPE')) {
            return res.json({
                status: 'success',
                reply: `Maaf ${finalNameWithTitle}, saya adalah asisten khusus jadwal akademik. Saya tidak dapat menjawab pertanyaan tersebut. 🙏\n\n🤖 *Lecturo Assistant*`
            });
        }
        else {
            return await processReadSchedule(res, userRef, message, finalNameWithTitle, formattedNow, todayStr, tomorrowStr);
        }

    } catch (error) {
        console.error("Error Chat AI:", error.message);
        return res.json({ status: 'success', reply: "⚠️ *Terjadi Kesalahan*\n\nMaaf, sistem AI sedang sibuk. Coba lagi dalam 1 menit." });
    }
};

// ============================================================================
// FUNGSI OCR (EKSTRAKSI EVENT DARI GAMBAR/PDF) - BULLETPROOF UPDATE
// ============================================================================
const extractEvent = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Teks input kosong' });

        // 1. PROMPT ENGINEERING YANG LEBIH TEGAS
        const prompt = `
        Analisis teks berikut untuk jadwal acara/akademik. Ekstrak ke format JSON murni:
        - "title": Judul acara.
        - "category": "Rapat, Seminar, Webinar, Workshop, Penelitian, atau Lainnya".
        - "date": format "DD/MM/YYYY".
        - "time": Waktu mulai (format "HH:mm"). Jika rentang "19.00 - 21.00", ambil "19:00".
        - "end_time": Waktu selesai (format "HH:mm"). Jika "19.00 - 21.00", ambil "21:00". Jika tidak ada, wajib isi estimasi 1 jam setelah waktu mulai.
        - "location": Lokasi acara.
        - "description": Ringkasan acara.

        Aturan Ekstraksi: 
        1. Isi string kosong "" jika data tidak ada, jangan gunakan null.
        2. Abaikan zona waktu (WITA/WIB).
        3. WAJIB kembalikan HANYA JSON Object tunggal dengan struktur persis seperti ini:
        {
          "title": "...", "category": "...", "date": "...", "time": "...", "end_time": "...", "location": "...", "description": "..."
        }

        Teks: "${text}"
        `;

        const result = await generateWithFallback(prompt);
        const response = await result.response;
        let cleanJson = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

        // 2. LOGIKA TAMENG NORMALISASI (ANTI-CRASH)
        let rawAiData = JSON.parse(cleanJson);
        let finalEventData = {};

        // Cek apakah AI membandel mengirim Array [ { ... } ]
        if (Array.isArray(rawAiData)) {
            finalEventData = rawAiData.length > 0 ? rawAiData[0] : {};
        }
        // Jika AI patuh mengirim Object { ... }
        else if (typeof rawAiData === 'object' && rawAiData !== null) {
            finalEventData = rawAiData;
        }

        // Kirim format baku ke Android
        res.json({ status: 'success', data: finalEventData });

    } catch (error) {
        console.error("Error Extract Event:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mengekstrak event.', error_details: error.message });
    }
};

module.exports = { chatWithGemini, extractEvent };