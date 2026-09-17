// utils/timeHelper.js

/**
 * Konversi format waktu "HH:mm" menjadi total menit dari tengah malam.
 */
const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const [h, m] = timeStr.split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
};

/**
 * Menambahkan 1 jam ke format waktu "HH:mm".
 */
const addOneHour = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return timeStr || '';
    const [h, m] = timeStr.split(':');
    const hour = (parseInt(h, 10) + 1) % 24;
    return `${hour.toString().padStart(2, '0')}:${m}`;
};

/**
 * Menghitung jam selesai baru secara proporsional sesuai durasi jadwal lama.
 */
const calculateProportionalEndTime = (oldStart, oldEnd, newStart) => {
    if (oldStart && oldEnd && oldStart.includes(':') && oldEnd.includes(':')) {
        const [oh1, om1] = oldStart.split(':').map(Number);
        const [oh2, om2] = oldEnd.split(':').map(Number);
        const diffMinutes = Math.max((oh2 * 60 + om2) - (oh1 * 60 + om1), 30);
        const [nh, nm] = newStart.split(':').map(Number);
        const newEndMin = (nh * 60 + nm + diffMinutes) % (24 * 60);
        const endH = Math.floor(newEndMin / 60).toString().padStart(2, '0');
        const endM = (newEndMin % 60).toString().padStart(2, '0');
        return `${endH}:${endM}`;
    }
    return addOneHour(newStart);
};

module.exports = {
    timeToMinutes,
    addOneHour,
    calculateProportionalEndTime
};