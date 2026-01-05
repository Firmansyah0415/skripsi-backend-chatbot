const db = require('./config/firebaseConfig');

async function tesDatabase() {
    try {
        console.log("Sedang mencoba menulis ke Firestore...");

        // Mencoba membuat koleksi tes
        const docRef = db.collection('tes_koneksi').doc('ping');
        await docRef.set({
            pesan: "Halo Firestore! Ini dari Backend Node.js",
            waktu: new Date().toISOString()
        });

        console.log("✅ SUKSES! Data berhasil ditulis ke Firestore.");
        console.log("Silakan cek Firebase Console Anda di koleksi 'tes_koneksi'.");

    } catch (error) {
        console.error("❌ GAGAL:", error);
    }
}

tesDatabase();