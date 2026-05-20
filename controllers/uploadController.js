const admin = require('firebase-admin');
const db = admin.firestore();
const fs = require('fs');
const csv = require('csv-parser');

// --- FUNGSI SABUK PENGAMAN (NORMALISASI JAM) ---
const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    let t = timeStr.trim().toLowerCase();
    const regex = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/;
    const match = t.match(regex);
    if (!match) return timeStr;
    let hours = parseInt(match[1], 10);
    let minutes = match[2];
    let modifier = match[3];
    if (modifier === 'pm' && hours < 12) hours += 12;
    if (modifier === 'am' && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
};

// --- FUNGSI OTOMATIS TAMBAH 1 JAM ---
const addOneHour = (timeStr) => {
    if (!timeStr) return '';
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return timeStr;
    let h = (parseInt(match[1], 10) + 1) % 24;
    return `${h.toString().padStart(2, '0')}:${match[2]}`;
};

// --- FUNGSI DETEKSI HARI OTOMATIS DARI TANGGAL (PENCEGAH BUG ANDROID) ---
const getHariIndo = (dateStrDDMMYYYY) => {
    if (!dateStrDDMMYYYY) return '-';
    const parts = dateStrDDMMYYYY.split('/');
    if (parts.length !== 3) return '-';
    // Format Date JS: Tahun, Bulan (0-11), Tanggal
    const d = new Date(parts[2], parts[1] - 1, parts[0]);
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return hari[d.getDay()];
};

// --- FUNGSI NORMALISASI PRIORITAS ---
const normalizePriority = (pStr) => {
    if (!pStr) return 'Sedang';
    const p = pStr.toLowerCase().trim();
    if (['tinggi', 'high', 'urgent', 'penting'].includes(p)) return 'Tinggi';
    if (['rendah', 'low', 'santai'].includes(p)) return 'Rendah';
    return 'Sedang';
};

const uploadScheduleCSV = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Tidak ada file CSV yang diupload.' });

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
                        const waktuSelesai = row.waktu_selesai ? normalizeTime(row.waktu_selesai) : addOneHour(waktuMulai);

                        if (!tipe || !judul || !tanggalRaw || !waktuMulai) {
                            errorCount++; continue;
                        }

                        let tanggalFormattedDDMMYYYY = tanggalRaw;
                        if (tanggalRaw.includes('-')) {
                            const parts = tanggalRaw.split('-');
                            if (parts.length === 3) tanggalFormattedDDMMYYYY = `${parts[2]}/${parts[1]}/${parts[0]}`;
                        }

                        // DETEKSI HARI OTOMATIS BERDASARKAN TANGGAL
                        const namaHariOtomatis = getHariIndo(tanggalFormattedDDMMYYYY);

                        let collectionName = '';
                        let scheduleData = {};
                        const nowISO = new Date().toISOString();
                        const notificationMinutes = parseInt(row.pengingat) || 0;

                        // 1. MAPPING TASKS
                        if (tipe === 'tugas') {
                            collectionName = 'tasks';
                            scheduleData = {
                                title: judul, date: tanggalFormattedDDMMYYYY,
                                time: waktuMulai, end_time: waktuSelesai,
                                location: row.lokasi || '', description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                input_source: 'WEB_UPLOAD', is_completed: false,
                                notification_minutes: notificationMinutes, updated_at: nowISO
                            };
                        }
                        // 2. MAPPING EVENTS
                        else if (tipe === 'event' || tipe === 'acara') {
                            collectionName = 'events';
                            const validCat = ['Rapat', 'Seminar', 'Webinar', 'Workshop', 'Lokakarya', 'Penelitian', 'Pengabdian Masyarakat', 'Lainnya'];
                            const matchCat = validCat.find(c => c.toLowerCase() === (row.kategori_event || '').toLowerCase());
                            scheduleData = {
                                title: judul, category: matchCat || 'Lainnya', date: tanggalFormattedDDMMYYYY,
                                time: waktuMulai, end_time: waktuSelesai,
                                location: row.lokasi || '', description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                input_source: 'WEB_UPLOAD', is_completed: false,
                                notification_minutes: notificationMinutes, updated_at: nowISO
                            };
                        }
                        // 3. MAPPING CONSULTATIONS
                        else if (tipe === 'konsultasi') {
                            collectionName = 'consultations';
                            // PERBAIKAN: Jika row.lokasi kosong/null/undefined, isi dengan "Belum ditentukan"
                            const lokasiFix = (row.lokasi && row.lokasi.trim() !== '') ? row.lokasi : 'Belum ditentukan';

                            scheduleData = {
                                title: judul,
                                date: tanggalFormattedDDMMYYYY,
                                start_time: waktuMulai,
                                end_time: waktuSelesai,
                                location: lokasiFix, // Sudah pakai variabel perbaikan
                                description: row.deskripsi || '',
                                priority: normalizePriority(row.prioritas),
                                status: 'SCHEDULED',
                                recurring_id: "",
                                input_source: 'WEB_UPLOAD',
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        }
                        // 4. MAPPING TEACHING (1 BARIS = 1 DOKUMEN FISIK)
                        else if (tipe === 'mengajar') {
                            collectionName = 'teaching_schedules';
                            scheduleData = {
                                course_name: judul,
                                class_code: row.kode_kelas || '-',
                                classroom: row.lokasi || '-',
                                day_of_week: namaHariOtomatis, // <--- HASIL DETEKSI OTOMATIS!
                                date: tanggalFormattedDDMMYYYY,
                                start_time: waktuMulai,
                                end_time: waktuSelesai,
                                student_count: parseInt(row.jml_mhs) || 0,
                                meeting_number: 1, // Web hanya upload 1 pertemuan. Looping ada di Android.
                                is_completed: false,
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        } else {
                            errorCount++; continue;
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
                    success: true, message: 'Proses generate jadwal dari CSV selesai.',
                    data_berhasil: successCount, data_gagal: errorCount
                });
            });
    } catch (error) {
        console.error('Upload API error:', error);
        res.status(500).json({ success: false, error: 'Terjadi kesalahan internal server.' });
    }
};

module.exports = { uploadScheduleCSV };