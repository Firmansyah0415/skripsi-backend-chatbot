// services/conflictService.js
const { timeToMinutes, addOneHour } = require('../utils/timeHelper');

/**
 * Memeriksa apakah ada jadwal yang bertabrakan pada tanggal dan rentang jam tertentu.
 * @param {Object} userRef - Dokumen referensi user Firestore
 * @param {string} targetDate - Tanggal "DD/MM/YYYY"
 * @param {string} startTime - Jam mulai "HH:mm"
 * @param {string} endTime - Jam selesai "HH:mm"
 * @param {string|null} excludeDocId - ID dokumen yang dikecualikan (khusus operasi UPDATE)
 * @returns {Promise<Array>} Daftar jadwal yang bertabrakan
 */
const checkScheduleConflict = async (userRef, targetDate, startTime, endTime, excludeDocId = null) => {
    const newStartMin = timeToMinutes(startTime);
    const newEndMin = timeToMinutes(endTime);

    if (newStartMin === null || newEndMin === null || !targetDate) return [];

    const [teachingSnap, eventSnap, taskSnap, consultSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('date', '==', targetDate).get(),
        userRef.collection('events').where('date', '==', targetDate).get(),
        userRef.collection('tasks').where('date', '==', targetDate).get(),
        userRef.collection('consultations').where('date', '==', targetDate).get()
    ]);

    const conflicts = [];

    // 1. Cek Mengajar
    teachingSnap.docs.forEach(doc => {
        if (excludeDocId && doc.id === excludeDocId) return;
        const d = doc.data();
        if (d.is_completed) return;
        const existStart = timeToMinutes(d.start_time);
        const existEnd = timeToMinutes(d.end_time);
        if (existStart !== null && existEnd !== null && newStartMin < existEnd && newEndMin > existStart) {
            conflicts.push({
                title: `👨‍🏫 Mengajar: ${d.course_name}`,
                time: `${d.start_time} - ${d.end_time}`,
                location: d.classroom && d.classroom !== '-' ? d.classroom : ''
            });
        }
    });

    // 2. Cek Acara / Agenda
    eventSnap.docs.forEach(doc => {
        if (excludeDocId && doc.id === excludeDocId) return;
        const d = doc.data();
        if (d.is_completed) return;
        const existStart = timeToMinutes(d.time);
        const existEnd = timeToMinutes(d.end_time || addOneHour(d.time));
        if (existStart !== null && existEnd !== null && newStartMin < existEnd && newEndMin > existStart) {
            conflicts.push({
                title: `🗓️ Acara: ${d.title}`,
                time: `${d.time} - ${d.end_time || addOneHour(d.time)}`,
                location: d.location || ''
            });
        }
    });

    // 3. Cek Tugas
    taskSnap.docs.forEach(doc => {
        if (excludeDocId && doc.id === excludeDocId) return;
        const d = doc.data();
        if (d.is_completed) return;
        const existStart = timeToMinutes(d.time);
        const existEnd = timeToMinutes(d.end_time || addOneHour(d.time));
        if (existStart !== null && existEnd !== null && newStartMin < existEnd && newEndMin > existStart) {
            conflicts.push({
                title: `📝 Tugas: ${d.title}`,
                time: `${d.time} - ${d.end_time || addOneHour(d.time)}`,
                location: d.location || ''
            });
        }
    });

    // 4. Cek Bimbingan / Konsultasi
    consultSnap.docs.forEach(doc => {
        if (excludeDocId && doc.id === excludeDocId) return;
        const d = doc.data();
        if (d.status === 'CANCELLED' || d.status === 'REJECTED' || d.status === 'COMPLETED') return;
        const existStart = timeToMinutes(d.start_time);
        const existEnd = timeToMinutes(d.end_time);
        if (existStart !== null && existEnd !== null && newStartMin < existEnd && newEndMin > existStart) {
            conflicts.push({
                title: `🎓 Bimbingan: ${d.title}`,
                time: `${d.start_time} - ${d.end_time}`,
                location: d.location && d.location !== 'Belum ditentukan' ? d.location : ''
            });
        }
    });

    return conflicts;
};

/**
 * Menyusun pesan penolakan bentrok jadwal.
 */
const buildConflictMessage = (conflicts, title, date, startTime, endTime, isUpdate = false) => {
    const actionHeader = isUpdate ? "GAGAL MENGGESER JADWAL (BENTROK)!" : "JADWAL BERTABRAKAN (BENTROK)!";
    const reasonText = isUpdate
        ? `Tidak dapat memindahkan *${title}* ke jam *${startTime} - ${endTime}* pada tanggal *${date}* karena bertabrakan dengan:`
        : `Gagal menjadwalkan *${title}* (⏰ ${startTime} - ${endTime}) pada tanggal *${date}* karena bertabrakan dengan agenda yang sudah ada:`;

    let reply = `⚠️ *${actionHeader}*\n\n${reasonText}\n\n`;
    conflicts.forEach((c, idx) => {
        reply += `${idx + 1}. *${c.title}*\n   ⏰ ${c.time}`;
        if (c.location) reply += ` | 📍 ${c.location}`;
        reply += `\n`;
    });
    reply += `\nMohon tentukan jam atau tanggal lain agar agenda Anda tidak tumpang tindih.\n\n🤖 *Lecturo Assistant*`;
    return reply;
};

module.exports = {
    checkScheduleConflict,
    buildConflictMessage
};