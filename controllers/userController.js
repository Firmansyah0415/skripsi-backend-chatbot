const db = require('../config/firebaseConfig');

const syncUser = async (req, res) => {
    try {
        const {
            uid,
            phone_number,
            email,
            full_name,
            university,
            faculty,
            major,
            photo_url
        } = req.body;

        if (!uid || !phone_number) {
            return res.status(400).json({ error: 'UID dan Nomor HP wajib ada' });
        }

        const userRef = db.collection('users').doc(uid);

        // 1. AMBIL DATA LAMA DULU (PENTING!)
        const docSnapshot = await userRef.get();
        const existingData = docSnapshot.exists ? docSnapshot.data() : {};

        // 2. SIAPKAN DATA BARU DENGAN LOGIKA PRIORITAS
        // Logika: Ambil data dari Request (Android). 
        // Jika Android kirim kosong, ambil dari Database (existingData).
        // Jika Database juga kosong, baru pakai string kosong "".

        const userData = {
            uid: uid,
            phone_number: phone_number,

            // Perbaikan di sini:
            email: email || existingData.email || "",
            full_name: full_name || existingData.full_name || "",
            university: university || existingData.university || "",
            faculty: faculty || existingData.faculty || "",
            major: major || existingData.major || "",
            photo_url: photo_url || existingData.photo_url || "",

            role: "dosen",
            updated_at: new Date().toISOString()
        };

        // 3. Cek User Baru (Created At)
        if (!docSnapshot.exists) {
            userData.created_at = new Date().toISOString();
            console.log(`[NEW USER] Membuat user baru: ${phone_number}`);
        } else {
            console.log(`[LOGIN] User lama login: ${existingData.full_name || phone_number}`);
        }

        // 4. Simpan ke Firestore
        await userRef.set(userData, { merge: true });

        // 5. Kembalikan data LENGKAP ke Android
        // Android akan menerima 'userData' yang sudah berisi nama dari database (jika ada)
        res.json({
            status: 'success',
            message: 'Data user berhasil disinkronisasi',
            data: userData
        });

    } catch (error) {
        console.error("Error Sync User:", error);
        res.status(500).json({ error: 'Gagal menyimpan data user' });
    }
};


// --- TAMBAHAN FUNGSI GET USER ---
const getUser = async (req, res) => {
    try {
        const uid = req.params.uid; // Ambil UID dari URL

        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'UID diperlukan' });
        }

        const userRef = db.collection('users').doc(uid);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).json({ status: 'error', message: 'User tidak ditemukan' });
        }

        res.json({
            status: 'success',
            message: 'Data user ditemukan', // <-- PENTING: TAMBAHKAN INI
            data: doc.data()
        });

    } catch (error) {
        console.error("Error Get User:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mengambil data user' });
    }
};

// Jangan lupa export fungsi baru ini
module.exports = { syncUser, getUser };