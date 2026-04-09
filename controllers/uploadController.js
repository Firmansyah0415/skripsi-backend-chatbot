const admin = require('firebase-admin');
const db = admin.firestore();
const fs = require('fs');
const csv = require('csv-parser');

// --- FUNGSI SABUK PENGAMAN (NORMALISASI JAM KE 24-JAM) ---
const normalizeTime = (timeStr) => {
    if (!timeStr) return '';

    // Hilangkan spasi berlebih dan jadikan huruf kecil (contoh: " 1:00:00 PM " jadi "1:00:00 pm")
    let t = timeStr.trim().toLowerCase();

    // Regex untuk membaca pola: "1:00", "13:00", "1:00 pm", "01:00:00 pm" dll
    const regex = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/;
    const match = t.match(regex);

    if (!match) return timeStr;

    let hours = parseInt(match[1], 10);
    let minutes = match[2];
    let modifier = match[3];

    // Logika Konversi ke 24 Jam
    if (modifier === 'pm' && hours < 12) {
        hours += 12; // Jam 1 PM jadi 13
    }
    if (modifier === 'am' && hours === 12) {
        hours = 0; // Jam 12 AM (tengah malam) jadi 00
    }

    // Pastikan jam selalu 2 digit (misal: jam 9 jadi "09")
    let formattedHours = hours.toString().padStart(2, '0');

    // Kembalikan ke format baku HH:mm
    return `${formattedHours}:${minutes}`;
};

// --- FUNGSI SABUK PENGAMAN (NORMALISASI PRIORITAS) ---
const normalizePriority = (priorityStr) => {
    if (!priorityStr) return 'Sedang'; // Default

    const p = priorityStr.toLowerCase().trim();

    // Jika mengandung kata-kata ini, jadikan Tinggi
    if (['tinggi', 'high', 'hight', 'urgent', 'penting'].includes(p)) {
        return 'Tinggi';
    }
    // Jika mengandung kata-kata ini, jadikan Rendah
    if (['rendah', 'low', 'santai'].includes(p)) {
        return 'Rendah';
    }

    // Sisanya (termasuk 'sedang', 'medium', dll)
    return 'Sedang';
};

const uploadScheduleCSV = async (req, res) => {
    try {
        // 1. Validasi File dan UID
        if (!req.file) {
            return res.status(400).json({ error: 'Tidak ada file CSV yang diupload.' });
        }

        const uid = req.body.uid; // UID dosen dari aplikasi Lecturo
        if (!uid) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'UID user (dosen) wajib disertakan.' });
        }

        const results = [];
        const filePath = req.file.path;

        // 2. Proses Parsing CSV
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                let successCount = 0;
                let errorCount = 0;

                // 3. Looping Data dan Mapping ke Firestore
                for (const row of results) {
                    try {
                        const tipe = row.tipe_jadwal?.trim().toLowerCase();
                        const judul = row.judul;
                        const tanggalRaw = row.tanggal; // Asumsi dari CSV format YYYY-MM-DD

                        // --- TERAPKAN NORMALISASI JAM DI SINI ---
                        const waktuMulai = normalizeTime(row.waktu_mulai);
                        const waktuSelesai = row.waktu_selesai ? normalizeTime(row.waktu_selesai) : waktuMulai;

                        if (!tipe || !judul || !tanggalRaw || !waktuMulai) {
                            errorCount++;
                            continue;
                        }

                        // Buat 2 Versi Format Tanggal
                        let tanggalFormattedDDMMYYYY = tanggalRaw;
                        const tanggalFormattedYYYYMMDD = tanggalRaw; // Biarkan utuh

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
                                date: tanggalFormattedDDMMYYYY, // Format DD/MM/YYYY
                                time: waktuMulai, // Sudah format baku 24-jam
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

                            // Validasi 8 Kategori (Case Insensitive)
                            const validCategories = ['Rapat', 'Seminar', 'Webinar', 'Workshop', 'Lokakarya', 'Penelitian', 'Pengabdian Masyarakat', 'Lainnya'];
                            let inputCategory = row.kategori_event || 'Lainnya';
                            const matchedCategory = validCategories.find(c => c.toLowerCase() === inputCategory.toLowerCase());
                            const finalCategory = matchedCategory ? matchedCategory : 'Lainnya';

                            scheduleData = {
                                title: judul,
                                category: finalCategory,
                                date: tanggalFormattedDDMMYYYY, // Format DD/MM/YYYY
                                time: waktuMulai, // Sudah format baku 24-jam
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
                                // --- [PERBAIKAN BUG 15] UBAH KE FORMAT DD/MM/YYYY ---
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
                            scheduleData = {
                                course_name: judul,
                                class_code: row.kode_kelas || '-',
                                classroom: row.lokasi || '-',
                                day_of_week: row.hari || '-',
                                start_time: waktuMulai,
                                end_time: waktuSelesai,
                                student_count: parseInt(row.jml_mhs) || 0,
                                start_date: tanggalFormattedDDMMYYYY, // Format DD/MM/YYYY
                                repetition_type: "COUNT",
                                repetition_value: "1",
                                notification_minutes: notificationMinutes,
                                updated_at: nowISO
                            };
                        } else {
                            errorCount++;
                            continue;
                        }

                        // Simpan ke sub-collection user
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