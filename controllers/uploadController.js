const admin = require('firebase-admin');
const db = admin.firestore();
const fs = require('fs');
const csv = require('csv-parser');
// Tambahkan ini di bagian paling atas file uploadController.js
const moment = require('moment');

// --- FUNGSI SABUK PENGAMAN (NORMALISASI JAM KE 24-JAM) ---
const normalizeTime = (timeStr) => {
    if (!timeStr) return '';

    let t = timeStr.trim().toLowerCase();

    const regex = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/;
    const match = t.match(regex);

    if (!match) return timeStr;

    let hours = parseInt(match[1], 10);
    let minutes = match[2];
    let modifier = match[3];

    if (modifier === 'pm' && hours < 12) {
        hours += 12;
    }
    if (modifier === 'am' && hours === 12) {
        hours = 0;
    }

    let formattedHours = hours.toString().padStart(2, '0');
    return `${formattedHours}:${minutes}`;
};

// --- FUNGSI SABUK PENGAMAN (OTOMATIS TAMBAH 1 JAM) ---
const addOneHour = (timeStr) => {
    if (!timeStr) return '';
    const regex = /^(\d{1,2}):(\d{2})$/;
    const match = timeStr.match(regex);
    if (!match) return timeStr;
    let h = parseInt(match[1], 10);
    let m = match[2];
    h = (h + 1) % 24;
    return `${h.toString().padStart(2, '0')}:${m}`;
};

// --- FUNGSI SABUK PENGAMAN (NORMALISASI PRIORITAS) ---
const normalizePriority = (priorityStr) => {
    if (!priorityStr) return 'Sedang';

    const p = priorityStr.toLowerCase().trim();

    if (['tinggi', 'high', 'hight', 'urgent', 'penting'].includes(p)) {
        return 'Tinggi';
    }
    if (['rendah', 'low', 'santai'].includes(p)) {
        return 'Rendah';
    }
    return 'Sedang';
};

const uploadScheduleCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Tidak ada file CSV yang diupload.' });
        }

        const uid = req.body.uid;
        if (!uid) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'UID user (dosen) wajib disertakan.' });
        }

        const results = [];
        const filePath = req.file.path;

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                let successCount = 0;
                let errorCount = 0;

                for (const row of results) {
                    try {
                        const tipe = row.tipe_jadwal?.trim().toLowerCase();
                        const judul = row.judul;
                        const tanggalRaw = row.tanggal;

                        const waktuMulai = normalizeTime(row.waktu_mulai);
                        // PERBAIKAN: Jika waktu_selesai kosong, otomatis +1 Jam dari waktu_mulai
                        const waktuSelesai = row.waktu_selesai ? normalizeTime(row.waktu_selesai) : addOneHour(waktuMulai);

                        if (!tipe || !judul || !tanggalRaw || !waktuMulai) {
                            errorCount++;
                            continue;
                        }

                        let tanggalFormattedDDMMYYYY = tanggalRaw;

                        if (tanggalRaw.includes('-')) {
                            const parts = tanggalRaw.split('-');
                            if (parts.length === 3) {
                                tanggalFormattedDDMMYYYY = `${parts[2]}/${parts[1]}/${parts[0]}`;
                            }
                        }

                        let collectionName = '';
                        let scheduleData = {};

                        const nowISO = new Date().toISOString();
                        const notificationMinutes = parseInt(row.pengingat) || 0;

                        // 1. MAPPING TASKS
                        if (tipe === 'tugas') {
                            collectionName = 'tasks';
                            scheduleData = {
                                title: judul,
                                date: tanggalFormattedDDMMYYYY,
                                time: waktuMulai,
                                end_time: waktuSelesai, // <--- TAMBAHAN BARU
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                input_source: 'WEB_UPLOAD',
                                is_completed: false,
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        }
                        // 2. MAPPING EVENTS
                        else if (tipe === 'event' || tipe === 'acara') {
                            collectionName = 'events';

                            const validCategories = ['Rapat', 'Seminar', 'Webinar', 'Workshop', 'Lokakarya', 'Penelitian', 'Pengabdian Masyarakat', 'Lainnya'];
                            let inputCategory = row.kategori_event || 'Lainnya';
                            const matchedCategory = validCategories.find(c => c.toLowerCase() === inputCategory.toLowerCase());
                            const finalCategory = matchedCategory ? matchedCategory : 'Lainnya';

                            scheduleData = {
                                title: judul,
                                category: finalCategory,
                                date: tanggalFormattedDDMMYYYY,
                                time: waktuMulai,
                                end_time: waktuSelesai, // <--- TAMBAHAN BARU
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                input_source: 'WEB_UPLOAD',
                                is_completed: false,
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        }
                        // 3. MAPPING CONSULTATIONS
                        else if (tipe === 'konsultasi') {
                            collectionName = 'consultations';
                            scheduleData = {
                                title: judul,
                                date: tanggalFormattedDDMMYYYY,
                                start_time: waktuMulai,
                                end_time: waktuSelesai,
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                status: 'SCHEDULED',
                                recurring_id: null,
                                input_source: 'WEB_UPLOAD',
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        }
                        // 4. MAPPING TEACHING
                        else if (tipe === 'mengajar') {
                            collectionName = 'teaching_schedules';

                            // Parse tanggal awal dari CSV
                            const startDate = moment(tanggalFormattedDDMMYYYY, "DD/MM/YYYY");
                            const count = parseInt(row.repetition_value) || 1; // Jumlah pertemuan

                            // Lakukan Loop untuk mencetak jadwal fisik
                            for (let i = 0; i < count; i++) {
                                // Hitung tanggal pertemuan ke-i (tambah 7 hari per pertemuan)
                                const meetingDate = startDate.clone().add(i * 7, 'days');

                                const meetingData = {
                                    user_id: uid, // Pastikan user_id tersimpan
                                    course_name: judul,
                                    class_code: row.kode_kelas || '-',
                                    classroom: row.lokasi || '-',
                                    day_of_week: row.hari || '-',
                                    start_time: waktuMulai,
                                    end_time: waktuSelesai,
                                    student_count: parseInt(row.jml_mhs) || 0,

                                    // --- FIELD YANG DITUNGGU ANDROID ---
                                    date: meetingDate.format("DD/MM/YYYY"),
                                    meeting_number: i + 1,
                                    is_completed: false,
                                    notification_minutes: notificationMinutes,
                                    updated_at: nowISO
                                };

                                // Simpan setiap pertemuan sebagai dokumen terpisah
                                const docRef = db.collection('users').doc(uid).collection(collectionName).doc();
                                await docRef.set(meetingData);
                            }

                            // Jangan lakukan await docRef.set(scheduleData) di luar loop untuk tipe mengajar
                            // Karena sudah ditangani di dalam loop di atas.
                            successCount++;
                            continue; // Lanjut ke row berikutnya
                        }

                        const docRef = db.collection('users').doc(uid).collection(collectionName).doc();
                        await docRef.set(scheduleData);

                        successCount++;
                    } catch (err) {
                        console.error('Error insert row:', err);
                        errorCount++;
                    }
                }

                fs.unlinkSync(filePath);

                res.status(200).json({
                    success: true,
                    message: 'Proses generate jadwal dari CSV selesai.',
                    data_berhasil: successCount,
                    data_gagal: errorCount
                });
            });
    } catch (error) {
        console.error('Upload API error:', error);
        res.status(500).json({ success: false, error: 'Terjadi kesalahan internal server.' });
    }
};

module.exports = { uploadScheduleCSV };