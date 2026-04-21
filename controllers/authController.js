const { client } = require('./whatsappClient'); // Import bot WA
const admin = require('firebase-admin');
const db = require('../config/firebaseConfig'); // <-- WAJIB IMPORT DATABASE

const otpStore = new Map();

// --- PERBAIKAN 1: FORMATTER LEBIH PINTAR ---
const formatPhoneNumber = (number) => {
    let formatted = number.replace(/\D/g, '');

    if (formatted.startsWith('0')) {
        formatted = '62' + formatted.slice(1);
    } else if (!formatted.startsWith('62')) {
        formatted = '62' + formatted;
    }
    return formatted;
};

// 1. REQUEST OTP
const requestOtp = async (req, res) => {
    try {
        // Ambil penanda 'source' dari request (Hanya web yang mengirim ini)
        const { phone_number, source } = req.body;

        if (!phone_number) {
            return res.status(400).json({ status: 'error', message: 'Nomor HP wajib diisi' });
        }

        const formattedPhone = formatPhoneNumber(phone_number);
        console.log(`📡 Request OTP untuk: ${formattedPhone} (Source: ${source || 'mobile'})`);

        // ==============================================================
        // 🛡️ FITUR KEAMANAN KHUSUS WEB PORTAL (Mencegah Spam)
        // ==============================================================
        if (source === 'web') {
            const cleanNumber = formattedPhone.startsWith('62') ? formattedPhone.substring(2) : formattedPhone;
            const usersRef = db.collection('users');

            // Cek di Firestore apakah nomor ini sudah pernah registrasi
            let snapshot = await usersRef.where('phone_number', '==', cleanNumber).limit(1).get();
            if (snapshot.empty) snapshot = await usersRef.where('phone_number', '==', '0' + cleanNumber).limit(1).get();
            if (snapshot.empty) snapshot = await usersRef.where('phone_number', '==', '62' + cleanNumber).limit(1).get();
            if (snapshot.empty) snapshot = await usersRef.where('phone_number', '==', '+' + formattedPhone).limit(1).get();

            if (snapshot.empty) {
                console.log(`❌ Akses Web Ditolak: Nomor belum terdaftar (${formattedPhone})`);
                return res.status(403).json({
                    status: 'error',
                    message: 'Akses ditolak. Nomor ini belum terdaftar di aplikasi Lecturo. Silakan daftar via Android terlebih dahulu.'
                });
            }
        }
        // ==============================================================

        // 2. Cek Kesiapan Bot
        if (!client.info) {
            return res.status(503).json({ status: 'error', message: 'Bot WhatsApp belum siap. Tunggu sebentar.' });
        }

        // --- PERBAIKAN 2: VALIDASI NOMOR KE SERVER WA ---
        const isRegistered = await client.getNumberId(formattedPhone);

        if (!isRegistered) {
            console.log(`❌ Nomor tidak terdaftar di WA: ${formattedPhone}`);
            return res.status(400).json({
                status: 'error',
                message: 'Nomor ini tidak terdaftar di WhatsApp.'
            });
        }

        const chatId = isRegistered._serialized;
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

        otpStore.set(formattedPhone, {
            code: otpCode,
            expires: Date.now() + 5 * 60 * 1000
        });

        console.log(`🔐 OTP Generated: ${otpCode} -> ${chatId}`);

        const message = `*KODE VERIFIKASI LECTURO*\n\nKode OTP Anda adalah: *${otpCode}*\n\nJangan berikan kode ini kepada siapa pun.`;
        await client.sendMessage(chatId, message);

        res.json({
            status: 'success',
            message: 'OTP berhasil dikirim ke WhatsApp',
            debug_phone: formattedPhone
        });

    } catch (error) {
        console.error("Error Request OTP:", error);
        res.status(500).json({ status: 'error', message: 'Gagal mengirim OTP via WA' });
    }
};

// 2. VERIFY OTP (Tidak ada yang diubah, tetap sama)
const verifyOtp = async (req, res) => {
    try {
        const { phone_number, otp_code } = req.body;
        const formattedPhone = formatPhoneNumber(phone_number);
        const storedData = otpStore.get(formattedPhone);

        if (!storedData) {
            return res.status(400).json({ status: 'error', message: 'OTP tidak ditemukan/kadaluarsa.' });
        }

        if (storedData.code !== otp_code) {
            return res.status(400).json({ status: 'error', message: 'Kode OTP Salah!' });
        }

        if (Date.now() > storedData.expires) {
            otpStore.delete(formattedPhone);
            return res.status(400).json({ status: 'error', message: 'Kode OTP sudah kadaluarsa.' });
        }

        otpStore.delete(formattedPhone);

        let uid;
        const firebasePhone = `+${formattedPhone}`;

        try {
            const userRecord = await admin.auth().getUserByPhoneNumber(firebasePhone);
            uid = userRecord.uid;
            console.log(`✅ User lama: ${uid}`);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                const newUser = await admin.auth().createUser({
                    phoneNumber: firebasePhone,
                    displayName: 'Dosen Baru',
                });
                uid = newUser.uid;
                console.log(`✅ User baru: ${uid}`);
            } else {
                throw error;
            }
        }

        const customToken = await admin.auth().createCustomToken(uid);
        console.log(`🎟️ Token Created for ${uid}`);

        res.json({
            status: 'success',
            message: 'Login Berhasil',
            token: customToken,
            uid: uid
        });

    } catch (error) {
        console.error("Error Verify OTP:", error);
        res.status(500).json({ status: 'error', message: 'Gagal memverifikasi OTP' });
    }
};

module.exports = { requestOtp, verifyOtp };