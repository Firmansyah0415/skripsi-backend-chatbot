const admin = require('firebase-admin');
const db = admin.firestore();

exports.getTimeline = async (req, res) => {
    try {
        const { uid, date } = req.query;
        if (!uid || !date) return res.status(400).json({ status: 'error', message: 'Parameter wajib diisi' });

        const [year, month, day] = date.split('-');
        const formattedDateAndroid = `${day}/${month}/${year}`;

        const userRef = db.collection('users').doc(uid);

        const [tasksSnap, eventsSnap, consultSnap, teachingSnap] = await Promise.all([
            userRef.collection('tasks').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('events').where('date', '==', formattedDateAndroid).get(),
            userRef.collection('consultations').where('date', '==', formattedDateAndroid).get(), // Tarik semua konsultasi dulu
            userRef.collection('teaching_schedules').where('date', '==', formattedDateAndroid).get()
        ]);

        let rawSchedules = [];

        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const [h, m] = timeStr.split(':');
            return parseInt(h) * 60 + parseInt(m);
        };

        // PERBAIKAN: Tambahkan parameter isCompleted
        const pushSchedule = (startStr, endStr, type, title, isCompleted = false) => {
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
                title: title,
                isCompleted: isCompleted // Simpan status selesai
            });
        };

        // 1. TUGAS & ACARA = PRIVATE (busy)
        tasksSnap.forEach(doc => {
            const d = doc.data();
            // Tidak di-return, tetap dimasukkan ke timeline
            pushSchedule(d.time, d.end_time, 'busy', d.title, d.is_completed);
        });
        eventsSnap.forEach(doc => {
            const d = doc.data();
            pushSchedule(d.time, d.end_time, 'busy', d.title, d.is_completed);
        });

        // 2. KONSULTASI = PUBLIK (consult)
        consultSnap.forEach(doc => {
            const d = doc.data();
            // Jika dibatalkan atau ditolak, HILANGKAN (Berubah jadi waktu luang)
            if (d.status === 'CANCELLED' || d.status === 'REJECTED') return;

            const isCompleted = d.status === 'COMPLETED';
            pushSchedule(d.start_time, d.end_time, 'consult', d.title, isCompleted);
        });

        // 3. MENGAJAR = PUBLIK (teaching)
        teachingSnap.forEach(doc => {
            const d = doc.data();
            const courseInfo = d.classroom && d.classroom !== '-' ? `${d.course_name} (${d.classroom})` : d.course_name;
            pushSchedule(d.start_time, d.end_time, 'teaching', `Mengajar: ${courseInfo}`, d.is_completed);
        });

        // Urutkan jadwal berdasarkan jam
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
                    startStr: formatTime(currentTime), endStr: formatTime(sched.start),
                    durationMins: sched.start - currentTime, type: 'free', title: 'Waktu Luang'
                });
            }
            if (sched.end > currentTime) {
                const actualStart = Math.max(currentTime, sched.start);

                let finalTitle = sched.title;
                // Penyamaran Privasi
                if (sched.type === 'busy') finalTitle = 'Sibuk / Tidak Bisa Diganggu';
                else if (sched.type === 'consult') finalTitle = 'Bimbingan Akademik';

                // PERBAIKAN: Jika jadwal sudah selesai, berikan stempel ✅
                if (sched.isCompleted) {
                    finalTitle += ' ✅ (Selesai)';
                }

                finalTimeline.push({
                    startStr: formatTime(actualStart), endStr: formatTime(sched.end),
                    durationMins: sched.end - actualStart, type: sched.type, title: finalTitle
                });
                currentTime = sched.end;
            }
        }

        if (currentTime < WORK_END) {
            finalTimeline.push({
                startStr: formatTime(currentTime), endStr: formatTime(WORK_END),
                durationMins: WORK_END - currentTime, type: 'free', title: 'Waktu Luang'
            });
        }

        res.json({ status: 'success', data: finalTimeline });

    } catch (error) {
        console.error("Error generate timeline:", error);
        res.status(500).json({ status: 'error', message: 'Gagal merender jadwal' });
    }
};

exports.searchDosen = async (req, res) => {
    try {
        const query = req.query.q?.toLowerCase() || '';
        if (query.length < 3) return res.json({ status: 'success', data: [] });

        const usersSnap = await db.collection('users').where('role', '==', 'dosen').get();
        let matched = [];
        usersSnap.forEach(doc => {
            const data = doc.data();
            const fullName = data.full_name || '';
            if (fullName.toLowerCase().includes(query)) {
                matched.push({ uid: doc.id, name: fullName, univ: data.university_name || 'Dosen Lecturo' });
            }
        });
        res.json({ status: 'success', data: matched });
    } catch (error) {
        console.error("Error search dosen:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mencari dosen' });
    }
};