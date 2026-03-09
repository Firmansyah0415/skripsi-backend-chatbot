const admin = require('firebase-admin');
const db = admin.firestore();
const fs = require('fs');
const csv = require('csv-parser');

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
                        const waktuMulai = row.waktu_mulai;

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
                                time: waktuMulai,
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: row.prioritas || 'Sedang',
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
                                time: waktuMulai,
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: row.prioritas || 'Sedang',
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
                                date: tanggalFormattedYYYYMMDD, // PERHATIAN: Format YYYY-MM-DD
                                start_time: waktuMulai,
                                end_time: row.waktu_selesai || waktuMulai,
                                location: row.lokasi || '',
                                description: row.deskripsi || '',
                                priority: row.prioritas || 'Medium',
                                status: 'SCHEDULED',
                                recurring_id: null, // Tambahkan ini agar sama dengan APK
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
                                end_time: row.waktu_selesai || waktuMulai,
                                student_count: parseInt(row.jml_mhs) || 0,
                                start_date: tanggalFormattedDDMMYYYY, // Format DD/MM/YYYY (berdasarkan chat sebelumnya)
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