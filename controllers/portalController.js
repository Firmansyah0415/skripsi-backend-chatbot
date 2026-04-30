// controllers/portalController.js
const { db } = require('../config/firebase'); // Sesuaikan dengan path config firebase-mu

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
            const fullName = data.fullName || "";

            if (fullName.toLowerCase().includes(keywordLower)) {
                results.push({
                    uid: data.uid || doc.id,
                    name: fullName,
                    univ: data.university || "Universitas" // Sesuaikan dengan field DB-mu
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

        // 1. Ubah ke format Android (dd/MM/yyyy)
        const [year, month, day] = date.split('-');
        const formattedDateAndroid = `${day}/${month}/${year}`;

        // 2. Dapatkan nama hari untuk Teaching Rules
        const dateObj = new Date(year, parseInt(month) - 1, day);
        const hariIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayOfWeek = hariIndo[dateObj.getDay()];

        const timeline = {};

        // Helper Function
        const markTimeline = (startTime, endTime, statusType) => {
            if (!startTime) return;
            const end = endTime || startTime;

            const startHour = parseInt(startTime.split(':')[0]);
            const endHour = parseInt(end.split(':')[0]);

            for (let i = startHour; i <= endHour; i++) {
                const timeKey = `${i < 10 ? '0' + i : i}:00`;
                if (i >= 8 && i <= 17) {
                    if (timeline[timeKey] !== 'busy') {
                        timeline[timeKey] = statusType;
                    }
                }
            }
        };

        // 3. Tarik data paralel dari 4 tabel
        const [tasksSnap, eventsSnap, consultSnap, teachingSnap] = await Promise.all([
            db.collection('tasks').where('userId', '==', uid).where('date', '==', formattedDateAndroid).get(),
            db.collection('events').where('userId', '==', uid).where('date', '==', formattedDateAndroid).get(),
            db.collection('consultations').where('userId', '==', uid).where('date', '==', formattedDateAndroid).where('status', '==', 'SCHEDULED').get(),
            db.collection('teaching_rules').where('userId', '==', uid).where('dayOfWeek', '==', dayOfWeek).get()
        ]);

        // 4. Masukkan ke timeline
        tasksSnap.forEach(doc => { const d = doc.data(); markTimeline(d.time, d.endTime, 'busy'); });
        eventsSnap.forEach(doc => { const d = doc.data(); markTimeline(d.time, d.endTime, 'busy'); });
        teachingSnap.forEach(doc => { const d = doc.data(); markTimeline(d.startTime, d.endTime, 'busy'); });
        consultSnap.forEach(doc => { const d = doc.data(); markTimeline(d.startTime, d.endTime, 'consult'); });

        res.json({ status: 'success', data: timeline });

    } catch (error) {
        console.error("Error generate timeline:", error);
        res.status(500).json({ status: 'error', message: 'Gagal merender jadwal' });
    }
};