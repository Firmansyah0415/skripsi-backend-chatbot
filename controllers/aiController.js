// controllers/aiController.js
const db = require('../config/firebaseConfig');
const { generateWithFallback } = require('../services/aiService');
const {
    handlePendingDelete,
    processReadSchedule,
    processCreateSchedule,
    processUpdateSchedule,
    processDeleteSchedule
} = require('../services/scheduleService');

// ============================================================================
// ORKESTRATOR UTAMA CHATBOT LECTURO
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

        const formattedNow = formatter.format(new Date()).replace(/\./g, ':');
        const todayStr = formattedNow.split(' ')[0];

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = formatter.format(tomorrow).split(' ')[0];

        const userRef = db.collection('users').doc(uid);

        // 1. PENCEGAT STATUS KONFIRMASI HAPUS ("YA" / "BATAL")
        const pendingResponse = await handlePendingDelete(userRef, message);
        if (pendingResponse) {
            return res.json(pendingResponse);
        }

        // 2. DATA USER & PERSONALISASI
        const userSnap = await userRef.get();
        const userData = userSnap.data() || {};
        const gender = userData.gender || "";
        const panggilan = gender.toLowerCase() === "laki-laki" ? "Bapak" : gender.toLowerCase() === "perempuan" ? "Ibu" : "";
        const finalName = userName || "Dosen";
        const finalNameWithTitle = panggilan ? `${panggilan} ${finalName}` : finalName;

        // 3. ROUTER INTENT ZERO-SHOT
        const intentPrompt = `Pesan user: "${message}". Tujuan utama user? 
        Pilih HANYA SATU KATA dari daftar berikut:
        - CREATE : jika ingin menambah/membuat jadwal baru.
        - UPDATE : jika ingin mengubah, menggeser jam, memindahkan tanggal, atau ganti lokasi.
        - DELETE : jika ingin menghapus/membatalkan jadwal.
        - READ : jika menanyakan jadwal, atau sekadar menyapa/salam (contoh: "halo", "selamat pagi", "p").
        - OUT_OF_SCOPE : jika bertanya hal di luar jadwal akademik.
        Jawab HANYA DENGAN SATU KATA tersebut tanpa tambahan apapun!`;

        const intentResult = await generateWithFallback(intentPrompt);
        const intentText = (await intentResult.response).text().toUpperCase();

        console.log(`🤖 Intent Deteksi: ${intentText} | User: ${finalNameWithTitle}`);

        if (intentText.includes('CREATE')) {
            const result = await processCreateSchedule(userRef, message, formattedNow);
            return res.json(result);
        } else if (intentText.includes('UPDATE') || intentText.includes('RESCHEDULE')) {
            const result = await processUpdateSchedule(userRef, message, formattedNow, todayStr, tomorrowStr);
            return res.json(result);
        } else if (intentText.includes('DELETE')) {
            const result = await processDeleteSchedule(userRef, message);
            return res.json(result);
        } else if (intentText.includes('OUT_OF_SCOPE') || intentText.includes('SCOPE')) {
            return res.json({
                status: 'success',
                reply: `Maaf ${finalNameWithTitle}, saya adalah asisten khusus jadwal akademik. Saya tidak dapat menjawab pertanyaan tersebut. 🙏\n\n🤖 *Lecturo Assistant*`
            });
        } else {
            const result = await processReadSchedule(userRef, message, finalNameWithTitle, todayStr, tomorrowStr);
            return res.json(result);
        }

    } catch (error) {
        console.error("Error Chat AI:", error.message);
        return res.json({ status: 'success', reply: "⚠️ *Terjadi Kesalahan*\n\nMaaf, sistem AI sedang sibuk. Coba lagi dalam 1 menit." });
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
        - "time": Waktu mulai (format "HH:mm").
        - "end_time": Waktu selesai (format "HH:mm"). Estimasi 1 jam jika kosong.
        - "location": Lokasi acara.
        - "description": Ringkasan acara.
        Aturan: Kembalikan HANYA JSON Object tunggal tanpa markdown:
        { "title": "...", "category": "...", "date": "...", "time": "...", "end_time": "...", "location": "...", "description": "..." }
        Teks: "${text}"
        `;

        const result = await generateWithFallback(prompt);
        const cleanJson = (await result.response).text().replace(/```json/gi, '').replace(/```/g, '').trim();

        let rawAiData = JSON.parse(cleanJson);
        const finalEventData = Array.isArray(rawAiData) ? (rawAiData[0] || {}) : (rawAiData || {});

        res.json({ status: 'success', data: finalEventData });

    } catch (error) {
        console.error("Error Extract Event:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mengekstrak event.', error_details: error.message });
    }
};

module.exports = { chatWithGemini, extractEvent };