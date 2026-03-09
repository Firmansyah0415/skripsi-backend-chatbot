const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { chatWithGemini } = require('./aiController');
const db = require('../config/firebaseConfig');

// --- PERBAIKAN: Deteksi OS secara otomatis ---
const isWindows = process.platform === 'win32';
const chromePath = isWindows
    ? 'C:\\Users\\LENOVO\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    : undefined; // Di Linux (VPS), undefined berarti pakai Chromium bawaan Puppeteer

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: chromePath, // <--- Gunakan variabel dinamis ini
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
        ]
    }
});

// --- FUNGSI PENCARI UID ---
const findUserByPhone = async (cleanNumber) => {
    // Pastikan input string
    if (!cleanNumber) return null;

    console.log(`🔍 Mencari User di DB dengan dasar: ${cleanNumber}`);
    const usersRef = db.collection('users');

    // 1. Cek format polosan (628...)
    let snapshot = await usersRef.where('phone_number', '==', cleanNumber).limit(1).get();

    // 2. Cek format pakai PLUS (+628...)
    if (snapshot.empty) {
        const plusNumber = '+' + cleanNumber;
        snapshot = await usersRef.where('phone_number', '==', plusNumber).limit(1).get();
    }

    // 3. Cek format lokal (08...)
    if (snapshot.empty && cleanNumber.startsWith('62')) {
        const localFormat = '0' + cleanNumber.substring(2);
        snapshot = await usersRef.where('phone_number', '==', localFormat).limit(1).get();
    }

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const userData = doc.data();
    return {
        uid: doc.id,
        name: userData.name || userData.full_name || "Dosen",
        role: userData.role || "User"
    };
};

client.on('qr', (qr) => {
    console.log('SCAN QR CODE INI DENGAN WHATSAPP ANDA:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client WhatsApp is ready!');
    console.log('Bot siap melayani User yang terdaftar...');
});

// --- BAGIAN PENTING: PENANGANAN PESAN DENGAN ANTI-CRASH ---
client.on('message', async (msg) => {
    // Filter pesan status
    if (msg.from === 'status@broadcast' || msg.from.includes('@newsletter')) return;

    let realNumber = '';
    let senderName = 'Unknown';

    try {
        // --- COBA CARA 1: Pakai getContact() (Cara Ideal) ---
        const contact = await msg.getContact();
        realNumber = contact.number;
        senderName = contact.pushname || contact.name || "User";

    } catch (err) {
        // --- JIKA ERROR (Seperti kasus Anda tadi), JANGAN MATIKAN SERVER ---
        console.warn("⚠️ Gagal mengambil Contact Info (Library Issue). Mencoba cara manual...");

        // --- CARA 2: Ambil Manual dari msg.from ---
        // msg.from biasanya: "62812345@c.us" atau "234234@lid"
        if (msg.from.includes('@c.us')) {
            realNumber = msg.from.replace('@c.us', '');
            senderName = "User (Manual)";
        } else {
            console.error("❌ Pesan dari ID aneh (@lid) dan getContact gagal. Pesan diabaikan.");
            return; // Nyerah, tidak bisa diproses
        }
    }

    console.log(`📩 Pesan Masuk dari: ${senderName} (${realNumber})`);

    try {
        // --- PROSES 1: IDENTIFIKASI USER ---
        const user = await findUserByPhone(realNumber);

        if (!user) {
            console.log("❌ User tidak dikenal/belum terdaftar.");
            return;
        }

        console.log(`✅ User Teridentifikasi: ${user.name}`);

        // --- PROSES 2: PROSES AI ---
        const req = {
            body: {
                message: msg.body,
                uid: user.uid,
                userName: user.name, // <--- PENTING: Kirim nama ke AI Controller
                userRole: user.role  // (Opsional) Kirim role
            }
        };
        const res = {
            json: (data) => {
                if (data.reply) {
                    msg.reply(data.reply);
                    console.log(`🤖 Membalas ke ${user.name}: Sukses`);
                }
            },
            status: (code) => ({ json: (err) => console.error("Error AI:", err) })
        };

        await chatWithGemini(req, res);

    } catch (error) {
        console.error("Error handling logic:", error);
    }
});

// --- TAMBAHAN: Global Error Handler untuk Puppeteer ---
// Agar server tidak mati mendadak jika ada error browser
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
    // Jangan exit process
});

const startWhatsAppBot = () => {
    console.log("Menjalankan layanan WhatsApp...");
    client.initialize();
};

module.exports = { startWhatsAppBot, client };