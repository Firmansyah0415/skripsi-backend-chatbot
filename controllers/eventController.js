const db = require('../config/firebaseConfig');

// 1. Sync Event (Simpan/Update)
const syncEvent = async (req, res) => {
    try {
        const {
            uid, user_id,
            event_id, id,
            ...eventData
        } = req.body;

        const finalUid = user_id || uid;
        const finalDocId = id || event_id;

        if (!finalUid) return res.status(400).json({ error: 'UID User wajib ada' });

        const collectionRef = db.collection('users').doc(finalUid).collection('events');

        let docRef;
        if (finalDocId) {
            docRef = collectionRef.doc(finalDocId);
        } else {
            docRef = collectionRef.doc();
        }

        const payload = {
            ...eventData,
            updated_at: new Date().toISOString()
        };

        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Event berhasil disimpan',
            data: {
                firestore_id: docRef.id,
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Event:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan event' });
    }
};

// 2. GET All Events by UID
const getAllEvents = async (req, res) => {
    try {
        const { uid } = req.params;
        const snapshot = await db.collection('users').doc(uid).collection('events').get();
        const events = [];

        snapshot.forEach(doc => {
            const data = doc.data();

            events.push({
                firestoreId: doc.id, // PENTING: ID Cloud
                ...data
            });
        });

        res.json({ status: 'success', data: events });
    } catch (error) {
        res.status(500).json({ error: 'Gagal ambil data' });
    }
};


// const getAllEvents = async (req, res) => {
//     try {
//         const { uid } = req.params;
//         const snapshot = await db.collection('users').doc(uid).collection('events').get();
//         const events = [];
//         snapshot.forEach(doc => {
//             events.push({
//                 firestoreId: doc.id, // PENTING: ID Cloud
//                 ...doc.data()
//             });
//         });
//         res.json({ status: 'success', data: events });
//     } catch (error) {
//         res.status(500).json({ error: 'Gagal ambil data' });
//     }
// };

// 3. Delete Event
const deleteEvent = async (req, res) => {
    try {
        const { uid, eventId } = req.params;

        if (!uid || !eventId) {
            return res.status(400).json({ error: 'Parameter tidak lengkap' });
        }

        await db.collection('users').doc(uid).collection('events').doc(eventId).delete();
        res.json({ status: 'success', message: 'Event berhasil dihapus' });
    } catch (error) {
        console.error("Error Delete Event:", error);
        res.status(500).json({ error: 'Gagal menghapus event' });
    }
};

module.exports = { syncEvent, getAllEvents, deleteEvent };