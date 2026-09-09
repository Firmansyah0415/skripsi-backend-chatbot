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
            '--js-flags=--max-old-space-size=256'
        ],
    }
});

// --- FUNGSI PENCARI UID ---
const findUserByPhone = async (rawNumber) => {
    if (!rawNumber) return null;

    const cleanNumber = rawNumber.replace(/\D/g, '');
    console.log(`🔍 Mencari User di DB dengan dasar: ${cleanNumber}`);

    const usersRef = db.collection('users');

    // 1. CARI BERDASARKAN LID (Fitur Privasi WA Business)
    let snapshot = await usersRef.where('whatsapp_lid', '==', cleanNumber).limit(1).get();

    // 2. CARI BERDASARKAN NOMOR HP NORMAL
    if (snapshot.empty) {
        snapshot = await usersRef.where('phone_number', '==', cleanNumber).limit(1).get();
    }

    // 3. Fallback format lokal/plus (Jaga-jaga)
    if (snapshot.empty) {
        const plusNumber = '+' + cleanNumber;
        snapshot = await usersRef.where('phone_number', '==', plusNumber).limit(1).get();
    }

    // 4. Fallback jika depannya 62, coba cari 08...
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

// --- FITUR AUTO-RECOVER (BANGKIT OTOMATIS JIKA KONEKSI PUTUS) ---
client.on('disconnected', (reason) => {
    console.log('🔴 Bot Terputus dari sistem WhatsApp! Alasan:', reason);
    console.log('🔄 Mencoba menghubungkan ulang dalam 5 detik...');
    try {
        client.destroy();
    } catch (e) { }
    setTimeout(() => {
        client.initialize();
    }, 5000);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Gagal Autentikasi! Sesi korup:', msg);
});

// --- MAP UNTUK ANTI-SPAM / ANTI-LOOP ---
const antiSpamCache = new Map();

// --- BAGIAN PENTING: PENANGANAN PESAN ---
client.on('message', async (msg) => {
    // 1. Abaikan Status, Newsletter, dan GRUP (@g.us)
    if (msg.from === 'status@broadcast' || msg.from.includes('@newsletter') || msg.from.includes('@g.us')) return;

    // 2. SISTEM ANTI-LOOP (Ramah pengguna, tapi memblokir bot provider/loop)
    const now = Date.now();
    const rateLimit = antiSpamCache.get(msg.from) || { count: 0, firstMessageTime: now };

    // Reset hanya jika sudah lewat 10 detik dari pesan PERTAMA
    if (now - rateLimit.firstMessageTime > 10000) {
        rateLimit.count = 0;
        rateLimit.firstMessageTime = now;
    }
    rateLimit.count += 1;
    antiSpamCache.set(msg.from, rateLimit);

    // Toleransi 6 pesan per 10 detik
    if (rateLimit.count > 6) {
        console.warn(`🛑 [ANTI-SPAM AKTIF] Mengabaikan spam dari ${msg.from}`);
        return;
    }

    let realNumber = '';
    let senderName = 'Unknown';
    let isLid = false;

    try {
        const contact = await msg.getContact();

        // 3. BLOKIR AKUN OFFICIAL / CENTANG HIJAU (IM3, Telkomsel, WA, dll)
        if (contact.isVerified || contact.id.user === '0') {
            console.log(`🚫 [BLOKIR OFFICIAL] Mengabaikan pesan dari Akun Centang Hijau: ${contact.name || msg.from}`);
            return;
        }

        // ==============================================================
        // DARI SINI KE BAWAH ADALAH KODE ASLI ANDA, TIDAK ADA YANG DIUBAH
        // ==============================================================
        senderName = contact.pushname || contact.name || "User";

        if (contact.number) {
            realNumber = contact.number;
            if (realNumber.length >= 14 && !realNumber.startsWith('62')) {
                isLid = true;
            }
        } else {
            if (msg.from.includes('@c.us') || msg.from.includes('@lid')) {
                realNumber = msg.from.replace('@c.us', '').replace('@lid', '');
                if (msg.from.includes('@lid') || (realNumber.length >= 14 && !realNumber.startsWith('62'))) {
                    isLid = true;
                }
            } else {
                return;
            }
        }
    } catch (err) {
        console.warn("⚠️ Gagal mengambil kontak. Fallback ekstrim...");
        if (msg.from.includes('@c.us') || msg.from.includes('@lid')) {
            realNumber = msg.from.replace('@c.us', '').replace('@lid', '');
            senderName = "User (Manual)";
            if (msg.from.includes('@lid') || (realNumber.length >= 14 && !realNumber.startsWith('62'))) {
                isLid = true;
            }
        } else {
            return;
        }
    }

    console.log(`📩 Pesan Masuk dari: ${senderName} (${realNumber}) [LID: ${isLid}]`);

    try {
        // --- PROSES 1: IDENTIFIKASI USER ---
        const user = await findUserByPhone(realNumber);

        // --- [LOGIKA BARU: TAUTAN AKUN WA BUSINESS] ---
        // Jika user tidak ditemukan, DAN pesan berisi "LINK "
        if (!user && msg.body.toUpperCase().startsWith('LINK ')) {
            const phoneToLink = msg.body.split(' ')[1];
            if (phoneToLink) {
                let cleanPhone = phoneToLink.replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);

                const usersRef = db.collection('users');
                const snapshot = await usersRef.where('phone_number', '==', cleanPhone).limit(1).get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];

                    // Simpan LID misterius ini ke akun user agar dikenali seterusnya!
                    await usersRef.doc(doc.id).set({ whatsapp_lid: realNumber }, { merge: true });

                    // Kirim pesan balasan menggunakan client.sendMessage (lebih tangguh dari msg.reply)
                    await client.sendMessage(msg.from, `✅ Berhasil! WhatsApp Anda telah ditautkan ke akun Lecturo.\n\nHalo *${doc.data().full_name}*, ada yang bisa dibantu?`);
                    return;
                } else {
                    await client.sendMessage(msg.from, `❌ Nomor HP ${cleanPhone} belum terdaftar di Aplikasi Lecturo.`);
                    return;
                }
            }
        }

        // Jika user masih tidak ditemukan
        if (!user) {
            console.log("❌ User tidak dikenal/belum terdaftar.");

            // PERBAIKAN: Gunakan client.sendMessage ke msg.from agar WA tidak bingung dengan ID LID
            try {
                await client.sendMessage(msg.from, `Halo *${senderName}*!\nKarena kebijakan privasi WhatsApp Business, nomor HP Anda disembunyikan oleh sistem Meta.\n\nKetik *LINK NomorHP* (Contoh: *LINK 0812345678*) untuk menautkan chat ini dengan akun Lecturo Anda secara permanen.`);
            } catch (replyErr) {
                console.error("Gagal mengirim pesan balasan peringatan LINK:", replyErr);
            }
            return;
        }

        console.log(`✅ User Teridentifikasi: ${user.name}`);

        // --- PROSES 2: PROSES AI ---
        const req = {
            body: {
                message: msg.body,
                uid: user.uid,
                userName: user.name,
                userRole: user.role
            }
        };

        const res = {
            json: async (data) => {
                if (data.reply) {
                    // PERBAIKAN: Gunakan client.sendMessage
                    try {
                        await client.sendMessage(msg.from, data.reply);
                        console.log(`🤖 Membalas ke ${user.name}: Sukses`);
                    } catch (replyErr) {
                        console.error(`🤖 Gagal membalas ke ${user.name}:`, replyErr);
                    }
                }
            },
            status: (code) => ({ json: (err) => console.error("Error AI:", err) })
        };

        await chatWithGemini(req, res);

    } catch (error) {
        console.error("Error handling logic:", error);
    }
});

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const startWhatsAppBot = () => {
    console.log("Menjalankan layanan WhatsApp...");
    client.initialize();
};

module.exports = { startWhatsAppBot, client };