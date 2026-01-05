const model = require('../config/gemini');
const db = require('../config/firebaseConfig');

// --- HELPER 1: Format Jadwal Mengajar ---
const formatTeaching = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal mengajar)";

    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        const hari = data.day_of_week || "Hari ?";
        // Kirim data mentah agar AI bisa memformatnya
        text += `- [KULIAH] Matkul: "${data.course_name}". Hari: ${hari}. Jam: ${data.start_time}-${data.end_time}. Ruang: ${data.classroom}.\n`;
    });
    return text;
};

// --- HELPER 2: Format Event (Acara) ---
const formatEvents = (docs) => {
    if (docs.empty) return "- (Tidak ada acara)";

    let text = "";
    docs.forEach(doc => {
        const data = doc.data();

        // PENTING: Kirim raw boolean is_completed agar AI yang menghitung logika emotikon
        const isDone = data.is_completed ? "true" : "false";

        text += `- [EVENT] Judul: "${data.title}". Tanggal: ${data.date}. Jam: ${data.time}. Lokasi: ${data.location}. IsCompleted: ${isDone}. Prioritas: ${data.priority}.\n`;
    });
    return text;
};

// --- HELPER 3: Format Tasks (Tugas) ---
const formatTasks = (docs) => {
    if (docs.empty) return "- (Tidak ada tugas)";

    let text = "";
    docs.forEach(doc => {
        const data = doc.data();

        // PENTING: Kirim raw boolean is_completed
        const isDone = data.is_completed ? "true" : "false";

        text += `- [TUGAS] Judul: "${data.title}". DeadlineTanggal: ${data.date}. DeadlineJam: ${data.time}. Prioritas: ${data.priority}. IsCompleted: ${isDone}.\n`;
    });
    return text;
};

// --- FUNGSI UTAMA: CHATBOT CERDAS (MULTI-DATA) ---
const chatWithGemini = async (req, res) => {
    try {
        const { message, uid, userName, userRole } = req.body;

        if (!message) return res.status(400).json({ error: 'Pesan kosong' });
        if (!uid) return res.status(400).json({ error: 'UID diperlukan' });

        const finalName = userName || "Dosen";
        const finalRole = userRole || "User";

        // --- 1. SETTING WAKTU SYSTEM ---
        const now = new Date();
        // Format jam yang mudah dibaca AI: DD/MM/YYYY HH:mm
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const formattedNow = `${day}/${month}/${year} ${hours}:${minutes}`;

        // --- 2. AMBIL DATA DARI FIRESTORE ---
        const userRef = db.collection('users').doc(uid);
        const [teachingSnap, eventSnap, taskSnap] = await Promise.all([
            userRef.collection('teaching_schedules').get(),
            userRef.collection('events').get(),
            userRef.collection('tasks').get()
        ]);

        // --- 3. FORMAT DATA MENJADI TEKS RAW ---
        const dataTeaching = formatTeaching(teachingSnap);
        const dataEvents = formatEvents(eventSnap);
        const dataTasks = formatTasks(taskSnap);

        // --- 4. RAKIT KONTEKS DATA ---
        const contextData = `
        DATA RAW JADWAL USER:
        
        A. JADWAL MENGAJAR:
        ${dataTeaching}

        B. EVENT / ACARA:
        ${dataEvents}

        C. TUGAS / TASKS:
        ${dataTasks}
        `;

        // --- 5. BUAT PROMPT GEMINI (UPDATED) ---
        const prompt = `
        Kamu adalah asisten dosen bernama "Lecturo Assistant".

        DATA KONTEKS:
        - Waktu Saat Ini (Current Time System): ${formattedNow}
        - Nama User: ${finalName}

        ${contextData}

        ATURAN FORMATTING (STRICT):
        1. Gunakan Header Kategori (Hanya jika ada datanya):
           - Tugas = 📝 **DAFTAR TUGAS**
           - Event = 🗓️ **ACARA / AGENDA**
           - Mengajar = 👨‍🏫 **JADWAL MENGAJAR**
        2. Judul jadwal harus di-Bold (*Judul*). Jika judul > 6 kata, ringkas judulnya.
        3. Baris Metadata gunakan format persis ini:
           - 📅 [Tanggal] ⏰ [Jam]
           - 📍 [Lokasi] (Jika ada lokasi, ringkas namanya misal "Zoom Cloud Meeting" jadi "Zoom")

        ATURAN LOGIKA STATUS & EMOTIKON (PENTING):
        Cek field 'IsCompleted' dan Bandingkan Waktu Jadwal dengan 'Waktu Saat Ini':
        - Status: Selesai (IsCompleted = true) -> Gunakan emot ✅ [Selesai].
        - Status: Belum Selesai TAPI Waktu Jadwal > Waktu Saat Ini -> Gunakan emot ⏳ [Upcoming].
        - Status: Belum Selesai DAN Waktu Jadwal < Waktu Saat Ini (Kadaluarsa) -> Gunakan emot ⛔ [Terlewat].

        ATURAN PRIORITAS:
        - Tinggi = 🔴, Sedang = 🟡, Rendah = 🟢.

        CONTOH FORMAT OUTPUT (Ikuti style ini):
        📝 **DAFTAR TUGAS**
        *Revisi Bab 4*
        🔴 Tinggi | ⛔ Terlewat
        📅 03/01/2026 ⏰ 23:59

        INSTRUKSI RESPON:
        - Jawab pertanyaan user: "${message}"
        - Jika user meminta jadwal, tampilkan sesuai format di atas.
        - Jika user hanya menyapa, sapa balik dan tawarkan untuk mengecek jadwal.
        `;

        // --- 6. KIRIM KE GEMINI ---
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textReply = response.text();

        // Footer Branding
        const brandedReply = `${textReply}\n\n🤖 *Lecturo Assistant*`;

        res.json({ status: 'success', reply: brandedReply });

    } catch (error) {
        console.error("Error Chat AI:", error.message); // Log pesan errornya saja biar terminal tidak penuh

        // --- SOLUSI ANTI CRASH: HANDLE RATE LIMIT ---

        // Cek apakah errornya karena Limit Habis (429) atau Server Overload (503)
        if (error.status === 429 || error.message.includes('429') || error.message.includes('Quota exceeded')) {
            // JANGAN STOP SERVER. Berikan pesan fallback ke user.
            return res.json({
                status: 'success', // Tetap return success agar WhatsApp Client tidak error
                reply: "⚠️ *Server Sibuk / Limit Tercapai*\n\nMaaf Pak/Bu, asisten sedang menerima terlalu banyak permintaan saat ini. Mohon tunggu sekitar 1-2 menit lalu coba lagi.\n\n🤖 *Lecturo System*"
            });
        }

        // Jika error lain (misal koneksi putus)
        return res.json({
            status: 'success',
            reply: "⚠️ *Terjadi Kesalahan Teknis*\n\nMaaf, saya tidak dapat memproses permintaan saat ini. Silakan coba lagi nanti."
        });
    }
};

// Fungsi 2: Extract Event (OCR)
const extractEvent = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) return res.status(400).json({ error: 'Teks input kosong' });

        const prompt = `
        Analisis teks ini untuk jadwal acara/akademik. Ekstrak ke JSON:
        - "title": Judul acara.
        - "category": "Rapat", "Seminar", "Webinar", "Workshop", "Lokakarya", "Penelitian", "Pengabdian Masyarakat", atau "Lainnya".
        - "date": format "dd/MM/yyyy".
        - "time": format "HH:mm".
        - "location": Lokasi.
        - "description": Ringkasan.

        Aturan:
        1. Jika info tidak ada, isi string kosong "".
        2. Hanya JSON murni.

        Teks: "${text}"
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let cleanJson = response.text();

        cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
        const eventData = JSON.parse(cleanJson);

        res.json({ status: 'success', data: eventData });

    } catch (error) {
        console.error("Error Extract Event:", error);
        res.status(500).json({
            status: 'error',
            message: 'Gagal mengekstrak event.',
            error_details: error.message
        });
    }
};

module.exports = { chatWithGemini, extractEvent };