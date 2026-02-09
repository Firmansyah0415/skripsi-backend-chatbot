const db = require('../config/firebaseConfig');

// 1. Sync Focus Session (Simpan/Update)
const syncSession = async (req, res) => {
    try {
        const {
            uid, user_id,
            session_id, id,        // ID Sesi (bisa dari Android local ID atau kosong)
            task_id,               // ID Tugas di Firestore (taskFirestoreId)
            ...sessionData         // start_time, end_time, duration, status
        } = req.body;

        const finalUid = user_id || uid;
        const finalDocId = id || session_id;

        if (!finalUid) return res.status(400).json({ error: 'UID User wajib ada' });

        // Kita simpan di collection terpisah agar mudah query "Total waktu fokus minggu ini"
        const collectionRef = db.collection('users').doc(finalUid).collection('focus_sessions');

        let docRef;
        if (finalDocId) {
            docRef = collectionRef.doc(finalDocId);
        } else {
            docRef = collectionRef.doc();
        }

        const payload = {
            task_id: task_id || null, // Link ke tugas (bisa null jika tugas dihapus)
            ...sessionData,
            updated_at: new Date().toISOString()
        };

        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Sesi fokus berhasil disimpan',
            data: {
                firestoreId: docRef.id, // <--- PENTING: camelCase sesuai request Android
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Session:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan sesi fokus' });
    }
};

// 2. Get All Sessions (Untuk Restore/Backup)
const getAllSessions = async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid) return res.status(400).json({ error: 'UID tidak ditemukan' });

        const snapshot = await db.collection('users').doc(uid).collection('focus_sessions').get();

        const sessions = [];
        snapshot.forEach(doc => {
            sessions.push({
                session_id: doc.id,
                ...doc.data()
            });
        });

        res.json({ status: 'success', data: sessions });
    } catch (error) {
        console.error("Error Get Sessions:", error);
        res.status(500).json({ error: 'Gagal mengambil data sesi' });
    }
};

// 3. Delete Session (Opsional, tapi bagus ada)
const deleteSession = async (req, res) => {
    try {
        const { uid, sessionId } = req.params;
        await db.collection('users').doc(uid).collection('focus_sessions').doc(sessionId).delete();
        res.json({ status: 'success', message: 'Sesi berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus sesi' });
    }
};

module.exports = { syncSession, getAllSessions, deleteSession };