// utils/scheduleFormatter.js

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

/**
 * Menyusun balasan WhatsApp untuk pembacaan jadwal (READ) menggunakan template string.
 */
const buildReadScheduleMessage = (targetDate, finalName, teachingSnap, eventSnap, taskSnap, consultSnap) => {
    const isAllEmpty = teachingSnap.empty && eventSnap.empty && taskSnap.empty && consultSnap.empty;

    const formatPriority = (p) => {
        const val = (p || '').toLowerCase();
        if (val === 'tinggi') return '🔴 Tinggi';
        if (val === 'rendah') return '🟢 Rendah';
        return '🟡 Sedang';
    };

    const formatStatus = (isCompleted) => (isCompleted ? '✅ Selesai' : '⏳ Upcoming');

    let output = `Halo, *${finalName}*!\n`;

    if (isAllEmpty) {
        output += `Anda tidak memiliki agenda atau jadwal kegiatan untuk tanggal *${targetDate}*.`;
        return `${output}\n\n🤖 *Lecturo Assistant*`;
    }

    output += `Berikut adalah agenda Anda untuk tanggal *${targetDate}*:\n`;

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

    return `${output.trim()}\n\n🤖 *Lecturo Assistant*`;
};

module.exports = {
    formatTeaching,
    formatEvents,
    formatTasks,
    formatConsultations,
    buildReadScheduleMessage
};