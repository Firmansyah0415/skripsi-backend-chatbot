const admin = require("firebase-admin");
const serviceAccount = require("../firebase-key.json"); // Membaca kunci yang tadi didownload

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
    // Tidak perlu databaseURL jika hanya pakai Firestore
});

const db = admin.firestore();

console.log("🔥 Firebase Admin berhasil terhubung!");

module.exports = db;