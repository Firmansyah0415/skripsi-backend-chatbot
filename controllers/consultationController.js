const db = require('../config/firebaseConfig');

// 1. Sync Consultation (Simpan/Update)
const syncConsultation = async (req, res) => {
    try {
        const {
            uid, user_id,            // Identitas User
            consultation_id, id,     // ID Dokumen (bisa dari Android UUID)
            ...consultationData      // Sisa data (title, date, status, priority, dll)
        } = req.body;

        // Fallback untuk memastikan kita dapat UID dan DocID
        const finalUid = user_id || uid;
        const finalDocId = id || consultation_id;

        if (!finalUid) return res.status(400).json({ error: 'UID User wajib ada' });

        // Target Collection: users -> {uid} -> consultations
        const collectionRef = db.collection('users').doc(finalUid).collection('consultations');

        let docRef;
        if (finalDocId) {
            // Jika ID dikirim dari Android (misal UUID lokal), gunakan itu agar sinkron
            docRef = collectionRef.doc(finalDocId);
        } else {
            // Jika tidak ada ID, buat baru (auto-generated)
            docRef = collectionRef.doc();
        }

        const payload = {
            ...consultationData,
            updated_at: new Date().toISOString()
        };

        // Gunakan merge: true agar field yang tidak dikirim tidak terhapus
        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Jadwal konsultasi berhasil disimpan',
            data: {
                firestoreId: docRef.id,
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Consultation:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan jadwal konsultasi' });
    }
};

// 2. GET All Consultations by UID
const getAllConsultations = async (req, res) => {
    try {
        const { uid } = req.params;

        if (!uid) return res.status(400).json({ error: 'UID tidak ditemukan' });

        const snapshot = await db.collection('users').doc(uid).collection('consultations').get();

        const consultations = [];
        snapshot.forEach(doc => {
            consultations.push({
                firestoreId: doc.id, // Penting untuk mapping balik ke Room lokal
                ...doc.data()
            });
        });

        res.json({ status: 'success', data: consultations });
    } catch (error) {
        console.error("Error Get Consultations:", error);
        res.status(500).json({ error: 'Gagal mengambil data konsultasi' });
    }
};

// 3. Delete Consultation
const deleteConsultation = async (req, res) => {
    try {
        const { uid, consultationId } = req.params;

        if (!uid || !consultationId) {
            return res.status(400).json({ error: 'Parameter UID atau ID Konsultasi kurang' });
        }

        await db.collection('users').doc(uid).collection('consultations').doc(consultationId).delete();

        res.json({ status: 'success', message: 'Jadwal konsultasi berhasil dihapus' });
    } catch (error) {
        console.error("Error Delete Consultation:", error);
        res.status(500).json({ error: 'Gagal menghapus jadwal konsultasi' });
    }
};

module.exports = { syncConsultation, getAllConsultations, deleteConsultation };