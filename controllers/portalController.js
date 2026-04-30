// controllers/portalController.js
const admin = require('firebase-admin');
const db = admin.firestore();

// API 1: Pencarian Dosen
exports.searchDosen = async (req, res) => {
    try {
        const keyword = req.query.q;
        if (!keyword || keyword.length < 3) {
            return res.json({ status: 'success', data: [] });
        }

        const keywordLower = keyword.toLowerCase();

        // Asumsi data pengguna dosen ada di collection 'users'
        const usersSnapshot = await db.collection('users').get();
        const results = [];

        usersSnapshot.forEach(doc => {
            const data = doc.data();
            const fullName = data.full_name || "";

            if (fullName.toLowerCase().includes(keywordLower)) {
                results.push({
                    uid: data.uid || doc.id,
                    name: fullName,
                    univ: data.university || "Universitas" // Sesuaikan dengan field DB-mu jika ada
                });
            }
        });

        res.json({ status: 'success', data: results });
    } catch (error) {
        console.error("Error search dosen:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mencari data' });
    }
};

// API 2: Generate Timeline 12 Jam
exports.getTimeline = async (req, res) => {
    try {
        const { uid, date } = req.query; // date format: YYYY-MM-DD

        if (!uid || !date) {
            return res.status(400).json({ status: 'error', message: 'Parameter uid dan date wajib diisi' });
        }

        const [year, month, day] = date.split('-');
        const formattedDateAndroid = `${day}/${month}/${year}`;

        const dateObj = new Date(year, parseInt(month) - 1, day);
        const hariIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayOfWeek = hariIndo[dateObj.getDay()];

        // Tarik data paralel
        const userRef = db.collection('users').doc(uid);
        const [tasksSnap, eventsSnap, consultSnap, teachingSnap] = await Promise.all([
            userRef.collection('tasks').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('events').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('consultations').where('date', '==', formattedDateAndroid).where('status', '==', 'SCHEDULED').get(),
            userRef.collection('teaching_schedules').where('day_of_week', '==', dayOfWeek).get()
        ]);

        let rawSchedules = [];

        // Helper untuk mem-parsing jam ke total menit (dari jam 00:00)
        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const [h, m] = timeStr.split(':');
            return parseInt(h) * 60 + parseInt(m);
        };

        // Fungsi Helper untuk memasukkan ke rawSchedules
        const pushSchedule = (startStr, endStr, type, title) => {
            if (!startStr) return;
            const end = endStr || startStr; // Jika tidak ada end, anggap 1 jam (tapi di mobile kamu harusnya sudah ada)

            const startMins = timeToMinutes(startStr);
            let endMins = timeToMinutes(end);

            // Jika end_time tidak ada / sama dengan start_time, set durasi default 60 menit
            if (startMins === endMins) endMins = startMins + 60;

            // Pastikan jadwal berada di dalam rentang jam kerja (08:00 - 18:00)
            const WORK_START = 8 * 60;  // 480 menit
            const WORK_END = 18 * 60;   // 1080 menit

            // Jika jadwal benar-benar di luar jam kerja, abaikan
            if (endMins <= WORK_START || startMins >= WORK_END) return;

            // Potong jadwal agar tidak keluar dari batas jam 08:00 dan 18:00
            const finalStart = Math.max(startMins, WORK_START);
            const finalEnd = Math.min(endMins, WORK_END);

            rawSchedules.push({
                start: finalStart,
                end: finalEnd,
                type: type,
                title: title
            });
        };

        tasksSnap.forEach(doc => { const d = doc.data(); pushSchedule(d.time, d.end_time, 'busy', d.title); });
        eventsSnap.forEach(doc => { const d = doc.data(); pushSchedule(d.time, d.end_time, 'busy', d.title); });
        teachingSnap.forEach(doc => { const d = doc.data(); pushSchedule(d.start_time, d.end_time, 'busy', d.course_name); });
        consultSnap.forEach(doc => { const d = doc.data(); pushSchedule(d.start_time, d.end_time, 'consult', d.title); });

        // Urutkan jadwal dari yang paling pagi
        rawSchedules.sort((a, b) => a.start - b.start);

        // Algoritma Pintar: Menyisipkan "Waktu Luang" (Free Time) di antara jadwal
        const finalTimeline = [];
        const WORK_START = 8 * 60;
        const WORK_END = 18 * 60;
        let currentTime = WORK_START;

        // Fungsi format menit ke HH:MM
        const formatTime = (mins) => {
            const h = Math.floor(mins / 60).toString().padStart(2, '0');
            const m = (mins % 60).toString().padStart(2, '0');
            return `${h}:${m}`;
        };

        for (const sched of rawSchedules) {
            // Jika ada gap (celah) antara waktu saat ini dan jadwal berikutnya, itu adalah Waktu Luang
            if (sched.start > currentTime) {
                finalTimeline.push({
                    startStr: formatTime(currentTime),
                    endStr: formatTime(sched.start),
                    durationMins: sched.start - currentTime,
                    type: 'free',
                    title: 'Waktu Luang'
                });
            }

            // Mencegah jadwal tumpang tindih (Overlap). Jika overlap, prioritas ke jadwal yang sudah ada (mengikuti realitas)
            if (sched.end > currentTime) {
                const actualStart = Math.max(currentTime, sched.start);
                finalTimeline.push({
                    startStr: formatTime(actualStart),
                    endStr: formatTime(sched.end),
                    durationMins: sched.end - actualStart,
                    type: sched.type,
                    title: sched.type === 'consult' ? 'Bimbingan' : 'Sibuk / Tidak Bisa Diganggu' // Privasi terjaga
                });
                currentTime = sched.end;
            }
        }

        // Jika setelah semua jadwal selesai masih ada sisa waktu sampai jam 18:00, isi dengan Waktu Luang
        if (currentTime < WORK_END) {
            finalTimeline.push({
                startStr: formatTime(currentTime),
                endStr: formatTime(WORK_END),
                durationMins: WORK_END - currentTime,
                type: 'free',
                title: 'Waktu Luang'
            });
        }

        res.json({ status: 'success', data: finalTimeline });

    } catch (error) {
        console.error("Error generate timeline:", error);
        res.status(500).json({ status: 'error', message: 'Gagal merender jadwal' });
    }
};