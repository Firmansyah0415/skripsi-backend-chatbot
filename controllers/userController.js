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

        // ======================================================
        // [PERBAIKAN BUG BOT AMNESIA]: MESIN CUCI NOMOR HP
        // ======================================================
        let cleanPhone = phone_number.replace(/\D/g, ''); // Hapus spasi, +, strip, dll (sisa angka)

        // Standarisasi paksa ke format internasional 62...
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '62' + cleanPhone.slice(1);
        } else if (!cleanPhone.startsWith('62')) {
            cleanPhone = '62' + cleanPhone;
        }
        // ======================================================

        const userRef = db.collection('users').doc(uid);
        const docSnapshot = await userRef.get();
        const existingData = docSnapshot.exists ? docSnapshot.data() : {};

        const userData = {
            uid: uid,
            // Gunakan nomor yang sudah dicuci bersih!
            phone_number: cleanPhone,
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