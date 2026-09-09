const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { chatWithGemini } = require('./aiController');
const db = require('../config/firebaseConfig');

const isWindows = process.platform === 'win32';
const chromePath = isWindows
    ? 'C:\\Users\\LENOVO\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    : undefined;

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-js/main/dist/wppconnect-wa.js',
    },
    puppeteer: {
        headless: true,
        executablePath: chromePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-web-security',
            '--disable-audio-output',
            '--mute-audio',
            '--disable-software-rasterizer',
            '--disable-features=site-per-process'
        ],
    }
});

// --- FUNGSI PENCARI UID ---
const findUserByPhone = async (rawNumber) => {
    if (!rawNumber) return null;
    const cleanNumber = rawNumber.replace(/\D/g, '');
    const usersRef = db.collection('users');

    let snapshot = await usersRef.where('whatsapp_lid', '==', cleanNumber).limit(1).get();
    if (snapshot.empty) snapshot = await usersRef.where('phone_number', '==', cleanNumber).limit(1).get();
    if (snapshot.empty) snapshot = await usersRef.where('phone_number', '==', '+' + cleanNumber).limit(1).get();
    if (snapshot.empty && cleanNumber.startsWith('62')) {
        snapshot = await usersRef.where('phone_number', '==', '0' + cleanNumber.substring(2)).limit(1).get();
    }
    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const userData = doc.data();
    return { uid: doc.id, name: userData.name || userData.full_name || "Dosen", role: userData.role || "User" };
};

// --- EVENT WAJS ---
client.on('qr', (qr) => {
    console.log('\n==================================================');
    console.log('SCAN QR CODE INI DENGAN WHATSAPP ANDA:');
    console.log('==================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Memuat WhatsApp Web: ${percent}% - ${message}`);
});

// --- PERANGKAP SILENT RELOAD ---
let authCount = 0; // Penghitung jumlah login

client.on('authenticated', () => {
    authCount++;
    console.log(`🔑 Sesi WhatsApp Ditemukan & Terautentikasi! (Hitungan: ${authCount})`);

    // Jika log ini muncul lebih dari 1 kali (artinya browser nge-refresh sendiri)
    if (authCount > 1) {
        console.warn('⚠️ TERDETEKSI REFRESH HALAMAN (SILENT RELOAD) DARI WA WEB!');
        console.warn('🔄 Membunuh proses yang tuli agar PM2 me-restart dari awal...');
        process.exit(1); // Matikan paksa agar PM2 menyalakan ulang dengan otak yang segar
    }
});

client.on('auth_failure', msg => {
    console.error('❌ Gagal Autentikasi! Sesi korup. Silakan hapus folder .wwebjs_auth', msg);
    process.exit(1);
});

client.on('ready', () => {
    console.log('✅ Client WhatsApp is ready!');
    console.log('🤖 Bot siap melayani User yang terdaftar...');
});

client.on('disconnected', (reason) => {
    console.log('🔴 Bot Terputus dari WhatsApp! Alasan:', reason);
    if (reason === 'NAVIGATION') {
        console.log('🔄 Mengabaikan disconnect karena navigasi (memuat ulang)...');
    } else {
        console.log('🔄 Meminta PM2 me-restart server secara bersih...');
        process.exit(1);
    }
});

// --- MAP UNTUK ANTI-SPAM ---
const antiSpamCache = new Map();

client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast' || msg.from.includes('@newsletter') || msg.from.includes('@g.us')) return;

    const now = Date.now();
    const rateLimit = antiSpamCache.get(msg.from) || { count: 0, firstMessageTime: now };
    if (now - rateLimit.firstMessageTime > 10000) {
        rateLimit.count = 0;
        rateLimit.firstMessageTime = now;
    }
    rateLimit.count += 1;
    antiSpamCache.set(msg.from, rateLimit);

    if (rateLimit.count > 6) {
        console.warn(`🛑 [ANTI-SPAM AKTIF] Mengabaikan spam dari ${msg.from}`);
        return;
    }

    let realNumber = '';
    let senderName = 'Unknown';
    let isLid = false;

    try {
        const contact = await msg.getContact();
        if (contact.isVerified || contact.id.user === '0') return;

        senderName = contact.pushname || contact.name || "User";
        if (contact.number) {
            realNumber = contact.number;
            if (realNumber.length >= 14 && !realNumber.startsWith('62')) isLid = true;
        } else {
            if (msg.from.includes('@c.us') || msg.from.includes('@lid')) {
                realNumber = msg.from.replace('@c.us', '').replace('@lid', '');
                if (msg.from.includes('@lid') || (realNumber.length >= 14 && !realNumber.startsWith('62'))) isLid = true;
            } else return;
        }
    } catch (err) {
        if (msg.from.includes('@c.us') || msg.from.includes('@lid')) {
            realNumber = msg.from.replace('@c.us', '').replace('@lid', '');
            senderName = "User (Manual)";
            if (msg.from.includes('@lid') || (realNumber.length >= 14 && !realNumber.startsWith('62'))) isLid = true;
        } else return;
    }

    console.log(`📩 Pesan Masuk dari: ${senderName} (${realNumber})`);

    try {
        const user = await findUserByPhone(realNumber);

        if (!user && msg.body.toUpperCase().startsWith('LINK ')) {
            const phoneToLink = msg.body.split(' ')[1];
            if (phoneToLink) {
                let cleanPhone = phoneToLink.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);

                const snapshot = await db.collection('users').where('phone_number', '==', cleanPhone).limit(1).get();
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    await db.collection('users').doc(doc.id).set({ whatsapp_lid: realNumber }, { merge: true });
                    await client.sendMessage(msg.from, `✅ Berhasil! WhatsApp Anda telah ditautkan ke akun Lecturo.\n\nHalo *${doc.data().full_name}*, ada yang bisa dibantu?`);
                    return;
                } else {
                    await client.sendMessage(msg.from, `❌ Nomor HP ${cleanPhone} belum terdaftar di Aplikasi Lecturo.`);
                    return;
                }
            }
        }

        if (!user) {
            try {
                await client.sendMessage(msg.from, `Halo *${senderName}*!\nKarena kebijakan privasi, nomor HP Anda disembunyikan oleh Meta.\n\nKetik *LINK NomorHP* (Contoh: *LINK 0812345678*) untuk menautkan chat ini dengan akun Lecturo Anda.`);
            } catch (replyErr) { }
            return;
        }

        const req = { body: { message: msg.body, uid: user.uid, userName: user.name, userRole: user.role } };
        const res = {
            json: async (data) => {
                if (data.reply) {
                    try {
                        await client.sendMessage(msg.from, data.reply);
                        console.log(`🤖 Membalas ke ${user.name}: Sukses`);
                    } catch (replyErr) { console.error(`🤖 Gagal membalas ke ${user.name}:`, replyErr); }
                }
            },
            status: (code) => ({ json: (err) => console.error("Error AI:", err) })
        };

        await chatWithGemini(req, res);
    } catch (error) { console.error("Error handling logic:", error); }
});

const startWhatsAppBot = () => {
    console.log("Menjalankan layanan WhatsApp...");
    client.initialize();
};

module.exports = { startWhatsAppBot, client };