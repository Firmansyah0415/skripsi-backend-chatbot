const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { chatWithGemini } = require('./aiController');
const db = require('../config/firebaseConfig');

// Variabel global untuk menyimpan socket Baileys agar bisa dipanggil dari luar (misal oleh authController)
let sock;

// --- FUNGSI PENCARI UID (TIDAK BERUBAH) ---
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

// --- MAP UNTUK ANTI-SPAM ---
const antiSpamCache = new Map();

// --- FUNGSI UTAMA START BAILEYS ---
async function startWhatsAppBot() {
    console.log("Menjalankan layanan WhatsApp (Baileys)...");

    // Folder auth otomatis dibuat oleh Baileys (jauh lebih ringan dari wwebjs)
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita handle QR manual agar tampilannya rapi
        logger: pino({ level: 'fatal' }), // Matikan log bawaan Baileys yang terlalu ramai
        browser: ['Lecturo Bot', 'Chrome', '1.0.0'], // Nama perangkat yang terlihat di WA HP
        syncFullHistory: false // Tidak perlu memuat riwayat lama agar cepat
    });

    // Handle Event Koneksi (QR, Connected, Disconnected)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n==================================================');
            console.log('SCAN QR CODE INI DENGAN WHATSAPP ANDA:');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔴 Bot Terputus! Alasan:', lastDisconnect.error?.message);

            // Auto Reconnect (Self-Healing tanpa perlu PM2 Restart)
            if (shouldReconnect) {
                console.log('🔄 Menyambung ulang secara otomatis...');
                startWhatsAppBot();
            } else {
                console.log('❌ Anda telah Log Out. Silakan hapus folder "baileys_auth_info" dan scan ulang.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            console.log('✅ Client WhatsApp is ready!');
            console.log('🤖 Bot siap melayani User yang terdaftar...');
        }
    });

    // Simpan kredensial login setiap ada pembaruan
    sock.ev.on('creds.update', saveCreds);

    // Handle Pesan Masuk
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        // Abaikan pesan dari diri sendiri atau pesan kosong
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;

        // Abaikan pesan dari Grup atau Status WhatsApp
        if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;

        // Ambil isi teks (Baileys memiliki struktur pesan yang sedikit berbeda)
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!messageText) return;

        // --- SISTEM ANTI-SPAM (Dipertahankan) ---
        const now = Date.now();
        const rateLimit = antiSpamCache.get(remoteJid) || { count: 0, firstMessageTime: now };
        if (now - rateLimit.firstMessageTime > 10000) {
            rateLimit.count = 0;
            rateLimit.firstMessageTime = now;
        }
        rateLimit.count += 1;
        antiSpamCache.set(remoteJid, rateLimit);

        if (rateLimit.count > 6) {
            console.warn(`🛑 [ANTI-SPAM AKTIF] Mengabaikan spam dari ${remoteJid}`);
            return;
        }
        // ---------------------------------------

        // Ekstrak Nama dan Nomor HP
        const senderName = msg.pushName || "User";
        const realNumber = remoteJid.split('@')[0];
        let isLid = remoteJid.includes('@lid');

        console.log(`📩 Pesan Masuk dari: ${senderName} (${realNumber})`);

        try {
            // PROSES 1: IDENTIFIKASI USER (Fungsi Asli Anda)
            const user = await findUserByPhone(realNumber);

            // LOGIKA TAUTAN AKUN WA BUSINESS (Dipertahankan)
            if (!user && messageText.toUpperCase().startsWith('LINK ')) {
                const phoneToLink = messageText.split(' ')[1];
                if (phoneToLink) {
                    let cleanPhone = phoneToLink.replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);

                    const snapshot = await db.collection('users').where('phone_number', '==', cleanPhone).limit(1).get();
                    if (!snapshot.empty) {
                        const doc = snapshot.docs[0];
                        await db.collection('users').doc(doc.id).set({ whatsapp_lid: realNumber }, { merge: true });
                        await sock.sendMessage(remoteJid, { text: `✅ Berhasil! WhatsApp Anda telah ditautkan ke akun Lecturo.\n\nHalo *${doc.data().full_name}*, ada yang bisa dibantu?` });
                        return;
                    } else {
                        await sock.sendMessage(remoteJid, { text: `❌ Nomor HP ${cleanPhone} belum terdaftar di Aplikasi Lecturo.` });
                        return;
                    }
                }
            }

            if (!user) {
                try {
                    await sock.sendMessage(remoteJid, { text: `Halo *${senderName}*!\nKarena kebijakan privasi, nomor HP Anda disembunyikan oleh Meta.\n\nKetik *LINK NomorHP* (Contoh: *LINK 0812345678*) untuk menautkan chat ini dengan akun Lecturo Anda.` });
                } catch (replyErr) { }
                return;
            }

            // PROSES 2: PROSES AI (Dipertahankan)
            const req = { body: { message: messageText, uid: user.uid, userName: user.name, userRole: user.role } };

            // Membuat res mock agar fungsi AI Anda tetap berjalan normal
            const res = {
                json: async (data) => {
                    if (data.reply) {
                        try {
                            await sock.sendMessage(remoteJid, { text: data.reply });
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
}

// Ekspor startWhatsAppBot dan getter untuk sock agar bisa dipakai di tempat lain
module.exports = {
    startWhatsAppBot,
    getClient: () => sock
};