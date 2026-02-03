const db = require('../config/firebaseConfig');

// 1. Sync Pattern (Simpan/Update)
const syncPattern = async (req, res) => {
    try {
        const {
            uid, user_id,
            pattern_id, id,        // ID Pattern
            ...patternData         // titleTemplate, dayOfWeek, startTime, dll
        } = req.body;

        const finalUid = user_id || uid;
        const finalDocId = id || pattern_id;

        if (!finalUid) return res.status(400).json({ error: 'UID User wajib ada' });

        // Target Collection: users -> {uid} -> consultation_patterns
        const collectionRef = db.collection('users').doc(finalUid).collection('consultation_patterns');

        let docRef;
        if (finalDocId) {
            docRef = collectionRef.doc(finalDocId);
        } else {
            docRef = collectionRef.doc();
        }

        const payload = {
            ...patternData,
            updated_at: new Date().toISOString()
        };

        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Template pola berhasil disimpan',
            data: {
                firestoreId: docRef.id,
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Pattern:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan template pola' });
    }
};

// 2. GET All Patterns by UID
const getAllPatterns = async (req, res) => {
    try {
        const { uid } = req.params;

        if (!uid) return res.status(400).json({ error: 'UID tidak ditemukan' });

        const snapshot = await db.collection('users').doc(uid).collection('consultation_patterns').get();

        const patterns = [];
        snapshot.forEach(doc => {
            patterns.push({
                firestoreId: doc.id,
                ...doc.data()
            });
        });

        res.json({ status: 'success', data: patterns });
    } catch (error) {
        console.error("Error Get Patterns:", error);
        res.status(500).json({ error: 'Gagal mengambil template pola' });
    }
};

// 3. Delete Pattern
const deletePattern = async (req, res) => {
    try {
        const { uid, patternId } = req.params;

        if (!uid || !patternId) {
            return res.status(400).json({ error: 'Parameter tidak lengkap' });
        }

        await db.collection('users').doc(uid).collection('consultation_patterns').doc(patternId).delete();

        res.json({ status: 'success', message: 'Template pola berhasil dihapus' });
    } catch (error) {
        console.error("Error Delete Pattern:", error);
        res.status(500).json({ error: 'Gagal menghapus template pola' });
    }
};

module.exports = { syncPattern, getAllPatterns, deletePattern };