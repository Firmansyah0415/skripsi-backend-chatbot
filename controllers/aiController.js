const model = require('../config/gemini');
const db = require('../config/firebaseConfig');

// --- HELPER 1: Format Jadwal Mengajar ---
const formatTeaching = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal mengajar)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        const hari = data.day_of_week || "Hari ?";
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
        const isDone = data.is_completed ? "true" : "false";
        text += `- [TUGAS] Judul: "${data.title}". DeadlineTanggal: ${data.date}. DeadlineJam: ${data.time}. Prioritas: ${data.priority}. IsCompleted: ${isDone}.\n`;
    });
    return text;
};

// --- HELPER 4: Format Consultations (DISESUAIKAN: SESI UMUM) ---
const formatConsultations = (docs) => {
    if (docs.empty) return "- (Tidak ada jadwal sesi bimbingan)";
    let text = "";
    docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "SCHEDULED";

        // Ubah Label dari "Ket/Mhs" menjadi "Catatan/Topik"
        // Agar AI mengerti ini adalah deskripsi sesi, bukan nama orang
        text += `- [SESI BIMBINGAN] Judul Sesi: "${data.title}". Tanggal: ${data.date}. Jam: ${data.start_time} s/d ${data.end_time}. Lokasi: ${data.location || 'Ruang Dosen'}. Catatan: ${data.description || '-'}. Status: ${status}.\n`;
    });
    return text;
};

// --- FUNGSI UTAMA: CHATBOT CERDAS ---
const chatWithGemini = async (req, res) => {
    try {
        const { message, uid, userName, userRole } = req.body;

        if (!message) return res.status(400).json({ error: 'Pesan kosong' });
        if (!uid) return res.status(400).json({ error: 'UID diperlukan' });

        const finalName = userName || "Dosen";

        // --- 1. SETTING WAKTU SYSTEM ---
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const formattedNow = `${day}/${month}/${year} ${hours}:${minutes}`;

        // --- 2. AMBIL DATA DARI FIRESTORE ---
        const userRef = db.collection('users').doc(uid);

        const [teachingSnap, eventSnap, taskSnap, consultationSnap] = await Promise.all([
            userRef.collection('teaching_schedules').get(),
            userRef.collection('events').get(),
            userRef.collection('tasks').get(),
            userRef.collection('consultations').get()
        ]);

        // --- 3. FORMAT DATA MENJADI TEKS RAW ---
        const dataTeaching = formatTeaching(teachingSnap);
        const dataEvents = formatEvents(eventSnap);
        const dataTasks = formatTasks(taskSnap);
        const dataConsultations = formatConsultations(consultationSnap);

        // --- 4. RAKIT KONTEKS DATA ---
        const contextData = `
        DATA RAW JADWAL DOSEN:
        
        A. JADWAL MENGAJAR (KULIAH):
        ${dataTeaching}

        B. EVENT / ACARA:
        ${dataEvents}

        C. TUGAS / TASKS:
        ${dataTasks}

        D. JADWAL SESI BIMBINGAN (CONSULTATION):
        ${dataConsultations}
        `;

        // --- 5. BUAT PROMPT GEMINI (REVISI: GENERAL SLOT) ---
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
        
        2. Format Tampilan Per Item:
           - Judul harus di-Bold (*Judul*).
           - Baris Metadata: 📅 [Tanggal] ⏰ [Jam]
           - Baris Lokasi: 📍 [Lokasi]
           - Baris Catatan (Hanya jika ada): ℹ️ [Catatan/Deskripsi]

        ATURAN LOGIKA STATUS:
        - Jika tanggal jadwal < tanggal hari ini, anggap [Selesai/Lewat].
        - Jika tanggal jadwal >= tanggal hari ini, anggap [Upcoming].

        CONTOH OUTPUT (SESI BIMBINGAN):
        🎓 **JADWAL SESI BIMBINGAN**
        1. *Bimbingan Skripsi & KP*
           📅 20/02/2026 ⏰ 09:00 - 12:00
           📍 Lab RPL
           ℹ️ Catatan: Fokus Review Bab 4

        INSTRUKSI RESPON:
        - Jawab pertanyaan user: "${message}" secara sopan dan ringkas.
        - Jika user bertanya jadwal, tampilkan list sesuai format di atas.
        - Jangan mengarang nama mahasiswa jika tidak ada di data.
        `;

        // --- 6. KIRIM KE GEMINI ---
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textReply = response.text();

        const brandedReply = `${textReply}\n\n🤖 *Lecturo Assistant*`;

        res.json({ status: 'success', reply: brandedReply });

    } catch (error) {
        console.error("Error Chat AI:", error.message);

        if (error.status === 429 || error.message.includes('Quota exceeded')) {
            return res.json({
                status: 'success',
                reply: "⚠️ *Server Sibuk*\n\nMohon tunggu sebentar.\n\n🤖 *Lecturo System*"
            });
        }

        return res.json({
            status: 'success',
            reply: "⚠️ *Terjadi Kesalahan*\n\nMaaf, saya gagal memuat data jadwal Anda."
        });
    }
};

const extractEvent = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Teks input kosong' });

        const prompt = `
        Analisis teks ini untuk jadwal acara/akademik. Ekstrak ke JSON:
        - "title": Judul acara.
        - "category": "Rapat, Seminar, Webinar, Workshop, Penelitian, atau Lainnya".
        - "date": format "dd/MM/yyyy".
        - "time": format "HH:mm".
        - "location": Lokasi.
        - "description": Ringkasan.

        Aturan: Isi string kosong "" jika data tidak ada. Hanya return JSON murni.

        Teks: "${text}"
        `;

        const result = await model.generateContent(prompt);
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