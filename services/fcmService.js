// services/fcmService.js
const admin = require('firebase-admin');
const db = require('../config/firebaseConfig');

/**
 * Mengirim sinyal data latar belakang (Silent Push) ke aplikasi Android dosen.
 * @param {string} uid - ID Dosen di Firestore
 * @param {Object} syncPayload - Data perubahan { action: 'CREATE'|'UPDATE'|'DELETE', collection: '...' }
 */
const sendSyncSignal = async (uid, syncPayload = {}) => {
    try {
        if (!uid) return;

        // 1. Ambil token FCM perangkat dosen dari Firestore
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) return;

        const userData = userDoc.data();
        const fcmToken = userData.fcm_token || userData.fcmToken;

        if (!fcmToken) {
            console.log(`ℹ️ [FCM] User ${uid} belum memiliki fcm_token terdaftar di Android.`);
            return;
        }

        // 2. Siapkan Data-Only Payload (Semua value wajib berupa String di FCM Data Message)
        const message = {
            token: fcmToken,
            data: {
                type: 'BACKGROUND_SYNC',
                action: syncPayload.action || 'SYNC',
                collection: syncPayload.collection || 'all',
                timestamp: new Date().toISOString()
            },
            // Prioritas tinggi agar Android langsung memproses saat layar mati/doze mode
            android: {
                priority: 'high'
            }
        };

        // 3. Tembak pesan via Firebase Admin SDK
        const response = await admin.messaging().send(message);
        console.log(`🚀 [FCM Sync] Berhasil mengirim sinyal ${syncPayload.action} ke Android:`, response);

    } catch (error) {
        // Tangani jika token kedaluwarsa atau perangkat telah di-uninstall
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn(`⚠️ [FCM] Token perangkat user ${uid} sudah tidak valid.`);
        } else {
            console.error("❌ [FCM Error] Gagal mengirim silent push:", error.message);
        }
    }
};

module.exports = { sendSyncSignal };