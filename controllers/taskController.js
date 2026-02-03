const db = require('../config/firebaseConfig');

// 1. Sync Task
const syncTask = async (req, res) => {
    try {
        const {
            uid,
            user_id,
            task_id,
            id,
            ...taskData
        } = req.body;

        // Logika penentuan UID (sama seperti Event)
        const finalUid = user_id || uid;
        // Logika penentuan Doc ID (sama seperti Event)
        const finalDocId = id || task_id;

        if (!finalUid) return res.status(400).json({ error: 'UID User wajib ada' });

        const collectionRef = db.collection('users').doc(finalUid).collection('tasks');

        let docRef;
        if (finalDocId) {
            docRef = collectionRef.doc(finalDocId); // UPDATE
        } else {
            docRef = collectionRef.doc(); // CREATE
        }

        const payload = {
            ...taskData,
            updated_at: new Date().toISOString()
        };

        await docRef.set(payload, { merge: true });

        res.json({
            status: 'success',
            message: 'Task berhasil disimpan',
            data: {
                firestore_id: docRef.id,
                ...payload
            }
        });

    } catch (error) {
        console.error("Error Sync Task:", error);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan task' });
    }
};

// 2. [BARU] GET All Tasks by UID
const getAllTasks = async (req, res) => {
    try {
        const { uid } = req.params;

        // Pastikan nama collection sesuai dengan yang ada di database ('tasks')
        const snapshot = await db.collection('users').doc(uid).collection('tasks').get();

        const tasks = [];
        snapshot.forEach(doc => {
            tasks.push({
                firestoreId: doc.id, // PENTING: Agar Android tahu ID cloud-nya
                ...doc.data()
            });
        });

        res.json({ status: 'success', data: tasks });

    } catch (error) {
        console.error("Error Get All Tasks:", error);
        res.status(500).json({ error: 'Gagal mengambil data tugas' });
    }
};

// 3. Delete Task
const deleteTask = async (req, res) => {
    try {
        const { uid, taskId } = req.params;
        await db.collection('users').doc(uid).collection('tasks').doc(taskId).delete();
        res.json({ status: 'success', message: 'Task berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus task' });
    }
};

module.exports = { syncTask, getAllTasks, deleteTask };