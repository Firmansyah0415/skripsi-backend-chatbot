const db = require('../config/firebaseConfig');

// 1. Sync Task
const syncTask = async (req, res) => {
    try {
        const { uid, task_id, ...taskData } = req.body;

        if (!uid) return res.status(400).json({ error: 'UID User wajib ada' });

        // Target Collection: users/{uid}/tasks
        const collectionRef = db.collection('users').doc(uid).collection('tasks');

        let docRef;
        if (task_id) {
            docRef = collectionRef.doc(task_id);
        } else {
            docRef = collectionRef.doc();
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