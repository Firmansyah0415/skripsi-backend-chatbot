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
                    univ: data.university || "Universitas"
                });
            }
        });

        res.json({ status: 'success', data: results });
    } catch (error) {
        console.error("Error search dosen:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mencari data' });
    }
};

// API 2: Generate Timeline 12 Jam (Vertical UI)

exports.getTimeline = async (req, res) => {
    try {
        const { uid, date } = req.query;

        if (!uid || !date) {
            return res.status(400).json({ status: 'error', message: 'Parameter uid dan date wajib diisi' });
        }

        const [year, month, day] = date.split('-');
        const formattedDateAndroid = `${day}/${month}/${year}`;

        const targetDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0);

        const hariIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayOfWeek = hariIndo[targetDateObj.getDay()];

        const parseDDMMYYYY = (dateStr) => {
            if (!dateStr) return null;
            const parts = dateStr.split('/');
            if (parts.length !== 3) return null;
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 0, 0, 0);
        };

        const userRef = db.collection('users').doc(uid);
        const [tasksSnap, eventsSnap, consultSnap, teachingSnap] = await Promise.all([
            userRef.collection('tasks').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('events').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('consultations').where('date', '==', formattedDateAndroid).where('status', '==', 'SCHEDULED').get(),
            userRef.collection('teaching_schedules').where('day_of_week', '==', dayOfWeek).get()
        ]);

        let rawSchedules = [];

        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const [h, m] = timeStr.split(':');
            return parseInt(h) * 60 + parseInt(m);
        };

        const pushSchedule = (startStr, endStr, type, title) => {
            if (!startStr) return;
            const end = endStr || startStr;

            const startMins = timeToMinutes(startStr);
            let endMins = timeToMinutes(end);

            if (startMins === endMins) endMins = startMins + 60;

            const WORK_START = 8 * 60;
            const WORK_END = 18 * 60;

            if (endMins <= WORK_START || startMins >= WORK_END) return;

            const finalStart = Math.max(startMins, WORK_START);
            const finalEnd = Math.min(endMins, WORK_END);

            rawSchedules.push({
                start: finalStart,
                end: finalEnd,
                type: type,
                title: title
            });
        };

        // 1. TUGAS & ACARA = PRIVATE (busy)
        tasksSnap.forEach(doc => {
            const d = doc.data();
            if (d.is_completed === true) return;
            pushSchedule(d.time, d.end_time, 'busy', d.title);
        });

        eventsSnap.forEach(doc => {
            const d = doc.data();
            if (d.is_completed === true) return;
            pushSchedule(d.time, d.end_time, 'busy', d.title);
        });

        // 2. KONSULTASI = PUBLIK (consult)
        consultSnap.forEach(doc => {
            const d = doc.data();
            pushSchedule(d.start_time, d.end_time, 'consult', d.title);
        });

        // 3. MENGAJAR = PUBLIK (teaching) - Menampilkan info ruang kelas jika ada
        teachingSnap.forEach(doc => {
            const d = doc.data();
            const startDateObj = parseDDMMYYYY(d.start_date);

            if (!startDateObj) return;
            if (targetDateObj < startDateObj) return;

            if (d.repetition_type === 'COUNT') {
                const count = parseInt(d.repetition_value) || 1;
                const diffTime = targetDateObj - startDateObj;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const diffWeeks = Math.floor(diffDays / 7);

                if (diffWeeks >= count) return;
            } else if (d.repetition_type === 'DATE') {
                const endDateObj = parseDDMMYYYY(d.repetition_value);
                if (endDateObj && targetDateObj > endDateObj) return;
            }

            // Gunakan tipe 'teaching' dan gabungkan nama matkul + ruangan
            const courseInfo = d.classroom && d.classroom !== '-' ? `${d.course_name} (${d.classroom})` : d.course_name;
            pushSchedule(d.start_time, d.end_time, 'teaching', `Mengajar: ${courseInfo}`);
        });

        rawSchedules.sort((a, b) => a.start - b.start);

        const finalTimeline = [];
        const WORK_START = 8 * 60;
        const WORK_END = 18 * 60;
        let currentTime = WORK_START;

        const formatTime = (mins) => {
            const h = Math.floor(mins / 60).toString().padStart(2, '0');
            const m = (mins % 60).toString().padStart(2, '0');
            return `${h}:${m}`;
        };

        for (const sched of rawSchedules) {
            if (sched.start > currentTime) {
                finalTimeline.push({
                    startStr: formatTime(currentTime),
                    endStr: formatTime(sched.start),
                    durationMins: sched.start - currentTime,
                    type: 'free',
                    title: 'Waktu Luang'
                });
            }

            if (sched.end > currentTime) {
                const actualStart = Math.max(currentTime, sched.start);

                // FILTER JUDUL PRIVASI
                let finalTitle = sched.title;
                if (sched.type === 'busy') finalTitle = 'Sibuk / Tidak Bisa Diganggu'; // Tugas & Acara disamarkan
                else if (sched.type === 'consult') finalTitle = 'Bimbingan Akademik';

                finalTimeline.push({
                    startStr: formatTime(actualStart),
                    endStr: formatTime(sched.end),
                    durationMins: sched.end - actualStart,
                    type: sched.type,
                    title: finalTitle
                });
                currentTime = sched.end;
            }
        }

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