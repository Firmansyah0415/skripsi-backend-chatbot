// controllers/teachingController.js
const db = require('../config/firebaseConfig');

// 1. Simpan atau Update Jadwal (Sync)
const syncTeaching = async (req, res) => {
    try {
        const {
            user_id,
            uid,
            id,          // <--- PERBAIKAN: JANGAN LUPA TAMBAHKAN INI
            schedule_id,
            ...teachingData
        } = req.body;

        // Prioritaskan user_id dari Android (Request Baru), jika tidak ada baru cek uid (Request Lama)
        const finalUid = user_id || uid;

        // Prioritaskan id dari Android (Request Baru), jika tidak ada baru cek schedule_id
        const finalDocId = id || schedule_id;

        if (!finalUid) {
            return res.status(400).json({ status: 'error', message: 'User ID wajib ada' });
        }

        // Referensi ke Collection: users/{uid}/teaching_schedules
        const schedulesRef = db.collection('users').doc(finalUid).collection('teaching_schedules');

        let docRef;

        // Jika ada finalDocId, berarti UPDATE data lama. Jika tidak, CREATE baru.
        if (finalDocId) {
            docRef = schedulesRef.doc(finalDocId);
        } else {
            docRef = schedulesRef.doc(); // Auto-generate ID baru
        }

        // Tambahkan timestamp
        const payload = {
            ...teachingData,
            updated_at: new Date().toISOString()
        };

        // Simpan ke Firestore (merge: true agar tidak menimpa field lain jika ada)
        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Jadwal berhasil disimpan',
            data: {
                firestore_id: docRef.id, // Kembalikan ID ini ke Android agar disimpan di Room
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Teaching:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan jadwal' });
    }
};

// ... (Fungsi getTeachings dan deleteTeaching sudah benar, tidak perlu diubah)
const getTeachings = async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ error: 'UID diperlukan' });

        const snapshot = await db.collection('users').doc(uid).collection('teaching_schedules').get();

        const schedules = [];
        snapshot.forEach(doc => {
            schedules.push({
                id: doc.id,
                firestoreId: doc.id,
                ...doc.data()
            });
        });

        res.json({ status: 'success', data: schedules });

    } catch (error) {
        console.error("Error Get Teachings:", error);
        res.status(500).json({ error: 'Gagal mengambil data jadwal' });
    }
};

const deleteTeaching = async (req, res) => {
    try {
        const { uid, scheduleId } = req.params;

        if (!uid || !scheduleId) {
            return res.status(400).json({ error: 'Parameter tidak lengkap' });
        }

        await db.collection('users').doc(uid).collection('teaching_schedules').doc(scheduleId).delete();

        res.json({ status: 'success', message: 'Jadwal berhasil dihapus' });
    } catch (error) {
        console.error("Error Delete Teaching:", error);
        res.status(500).json({ error: 'Gagal menghapus jadwal' });
    }
};

module.exports = { syncTeaching, getTeachings, deleteTeaching };