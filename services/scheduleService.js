// services/scheduleService.js
const { generateWithFallback } = require('./aiService');
const { checkScheduleConflict, buildConflictMessage } = require('./conflictService');
const { addOneHour, calculateProportionalEndTime } = require('../utils/timeHelper');
const {
    formatTeaching,
    formatEvents,
    formatTasks,
    formatConsultations,
    buildReadScheduleMessage
} = require('../utils/scheduleFormatter');

const pendingDeleteMap = new Map();

/**
 * Memeriksa apakah user sedang memiliki sesi konfirmasi hapus ("YA" atau "BATAL")
 */
const handlePendingDelete = async (userRef, message) => {
    const uid = userRef.id;
    const pendingDelete = pendingDeleteMap.get(uid);
    if (!pendingDelete) return null;

    if (Date.now() > pendingDelete.expiresAt) {
        pendingDeleteMap.delete(uid);
        return null;
    }

    const cleanMsg = message.trim().toLowerCase();

    if (['ya', 'iya', 'y', 'oke', 'ok', 'hapus'].includes(cleanMsg)) {
        await userRef.collection(pendingDelete.collection).doc(pendingDelete.docId).delete();
        pendingDeleteMap.delete(uid);

        console.log(`🗑️ Jadwal [${pendingDelete.docId}] berhasil dihapus via konfirmasi.`);
        return {
            status: 'success',
            reply: `✅ Jadwal *${pendingDelete.title}* (${pendingDelete.date}) telah berhasil dihapus dari kalender Anda.\n\n🤖 *Lecturo Assistant*`
        };
    }

    if (['batal', 'tidak', 'gak', 'enggak', 'cancel', 'jangan'].includes(cleanMsg)) {
        pendingDeleteMap.delete(uid);
        return {
            status: 'success',
            reply: `Penghapusan jadwal *${pendingDelete.title}* dibatalkan. Agenda Anda tetap tersimpan aman.\n\n🤖 *Lecturo Assistant*`
        };
    }

    return null;
};

/**
 * 1. READ SCHEDULE
 */
const processReadSchedule = async (userRef, message, finalName, todayStr, tomorrowStr) => {
    const queryPrompt = `
    Tanggal Hari Ini: ${todayStr}
    Tanggal Besok: ${tomorrowStr}

    Pesan user: "${message}"

    Tugas: Tentukan tanggal jadwal yang dicari user. Kembalikan HANYA JSON:
    { "target_date": "DD/MM/YYYY" }
    Jika user hanya menyapa atau tidak menyebut waktu, gunakan Tanggal Hari Ini.
    `;

    let targetDate = todayStr;
    try {
        const queryResult = await generateWithFallback(queryPrompt);
        const cleanJson = (await queryResult.response).text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const aiQuery = JSON.parse(cleanJson);
        if (aiQuery.target_date) targetDate = aiQuery.target_date;
    } catch (e) {
        console.warn("⚠️ Fallback ke tanggal hari ini:", e.message);
    }

    console.log(`🔍 [PENCARIAN DB] Mengambil jadwal tanggal: ${targetDate}`);

    const [teachingSnap, eventSnap, taskSnap, consultSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('date', '==', targetDate).get(),
        userRef.collection('events').where('date', '==', targetDate).get(),
        userRef.collection('tasks').where('date', '==', targetDate).get(),
        userRef.collection('consultations').where('date', '==', targetDate).get()
    ]);

    const replyText = buildReadScheduleMessage(targetDate, finalName, teachingSnap, eventSnap, taskSnap, consultSnap);
    return { status: 'success', reply: replyText };
};

/**
 * 2. CREATE SCHEDULE
 */
const processCreateSchedule = async (userRef, message, formattedNow) => {
    const prompt = `
    WAKTU SAAT INI (SERVER): ${formattedNow}
    Ekstrak pesan ini untuk membuat jadwal baru: "${message}"
    Wajib kembalikan format JSON murni (tanpa markdown).
    {
      "is_data_complete": true atau false,
      "collection": "tasks" ATAU "events" ATAU "teaching_schedules" ATAU "consultations" ATAU "none",
      "data": { ... },
      "reply": "Teks balasan untuk user."
    }
    ATURAN KOLEKSI:
    - "Tugas" -> tasks | "Mengajar/Kuliah" -> teaching_schedules | "Konsultasi/Bimbingan" -> consultations | "Acara/Rapat" -> events.
    ATURAN TANGGAL & WAKTU:
    - Hitung tanggal akurat berdasarkan WAKTU SAAT INI (${formattedNow}). Jangan gunakan masa lalu.
    FORMAT DATA:
    > tasks: title, date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority (Tinggi/Sedang/Rendah), location, description.
    > events: title, category (Rapat/Seminar/Lainnya), date (DD/MM/YYYY), time (HH:mm), end_time (HH:mm), priority, location, description.
    > consultations: title, date (DD/MM/YYYY), start_time (HH:mm), end_time (HH:mm), priority, location, description.
    > teaching_schedules: course_name, class_code, day_of_week, date (DD/MM/YYYY), start_time (HH:mm), end_time (HH:mm), classroom, meeting_number (angka 1), student_count (angka 0).
    `;

    const result = await generateWithFallback(prompt);
    const cleanJson = (await result.response).text().replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);
        if (!aiData.is_data_complete || aiData.collection === 'none') {
            return { status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` };
        }

        const sanitizedData = {};
        for (const key in aiData.data) {
            sanitizedData[key] = (aiData.data[key] === null || aiData.data[key] === undefined) ? "" : aiData.data[key];
        }

        if (!('description' in sanitizedData)) sanitizedData.description = "";
        if (aiData.collection === 'teaching_schedules') {
            if (!('classroom' in sanitizedData)) sanitizedData.classroom = "";
        } else {
            if (!('location' in sanitizedData)) sanitizedData.location = "";
        }

        const startTimeToUse = sanitizedData.time || sanitizedData.start_time || "08:00";
        if (!sanitizedData.end_time) sanitizedData.end_time = addOneHour(startTimeToUse);

        if (aiData.collection === 'teaching_schedules' || aiData.collection === 'consultations') {
            sanitizedData.start_time = startTimeToUse;
        } else {
            sanitizedData.time = startTimeToUse;
        }

        const p = (sanitizedData.priority || '').toLowerCase();
        if (['tinggi', 'high', 'urgent'].includes(p)) sanitizedData.priority = "Tinggi";
        else if (['rendah', 'low', 'santai'].includes(p)) sanitizedData.priority = "Rendah";
        else sanitizedData.priority = "Sedang";

        // Cek bentrok
        const targetTitle = sanitizedData.course_name || sanitizedData.title || "Agenda Baru";
        const conflicts = await checkScheduleConflict(userRef, sanitizedData.date, startTimeToUse, sanitizedData.end_time);

        if (conflicts.length > 0) {
            return {
                status: 'success',
                reply: buildConflictMessage(conflicts, targetTitle, sanitizedData.date, startTimeToUse, sanitizedData.end_time, false)
            };
        }

        const finalData = {
            ...sanitizedData,
            input_source: 'WA_BOT',
            updated_at: new Date().toISOString(),
            notification_minutes: 15
        };

        if (aiData.collection === 'consultations') {
            finalData.status = 'SCHEDULED';
            finalData.recurring_id = "";
            delete finalData.is_completed;
        } else if (aiData.collection === 'teaching_schedules') {
            finalData.is_completed = false;
            finalData.meeting_number = parseInt(sanitizedData.meeting_number, 10) || 1;
            finalData.student_count = parseInt(sanitizedData.student_count, 10) || 0;
            finalData.classroom = sanitizedData.classroom || "";
            if (!finalData.class_code) finalData.class_code = "-";
            delete finalData.description;
            delete finalData.priority;
        } else {
            finalData.is_completed = false;
        }

        await userRef.collection(aiData.collection).add(finalData);
        return { status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` };

    } catch (e) {
        console.error("Gagal parse Create:", e);
        return {
            status: 'error',
            reply: "Maaf, format jadwal tidak dapat saya pahami. Mohon sebutkan nama acara dan waktunya dengan jelas.\n\n🤖 *Lecturo Assistant*"
        };
    }
};

/**
 * 3. UPDATE / RESCHEDULE
 */
const processUpdateSchedule = async (userRef, message, formattedNow, todayStr, tomorrowStr) => {
    console.log("🔍 [PENCARIAN DB] Mengambil jadwal aktif untuk di-update/reschedule...");

    const [teachingSnap, eventSnap, taskSnap, consultationSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('is_completed', '==', false).get(),
        userRef.collection('events').where('is_completed', '==', false).get(),
        userRef.collection('tasks').where('is_completed', '==', false).get(),
        userRef.collection('consultations').where('status', '==', 'SCHEDULED').get()
    ]);

    const contextData = `
    A. JADWAL MENGAJAR:\n${formatTeaching(teachingSnap)}
    B. EVENT / ACARA:\n${formatEvents(eventSnap)}
    C. TUGAS / TASKS:\n${formatTasks(taskSnap)}
    D. KONSULTASI:\n${formatConsultations(consultationSnap)}
    `;

    const prompt = `
    WAKTU SAAT INI (SERVER): ${formattedNow}
    Tanggal Hari Ini: ${todayStr}
    Tanggal Besok: ${tomorrowStr}

    Pesan user: "${message}"
    Daftar Jadwal Aktif Saat Ini:
    ${contextData}

    Tugas:
    1. Cocokkan jadwal mana yang ingin diubah/digeser oleh user dan ambil ID_DB nya.
    2. Ekstrak data apa saja yang diubah (tanggal, jam mulai, jam selesai, ruangan/lokasi, atau judul).
    Format balasan HANYA JSON murni (tanpa tanda kutip tiga atau format markdown):
    {
      "document_id": "ID_DB",
      "collection": "teaching_schedules ATAU events ATAU tasks ATAU consultations",
      "updated_fields": {
        "date": "DD/MM/YYYY (hanya jika tanggal berubah)",
        "time": "HH:mm (hanya jika jam mulai tugas/acara berubah)",
        "start_time": "HH:mm (hanya jika jam mulai mengajar/konsultasi berubah)",
        "end_time": "HH:mm (hanya jika jam selesai berubah)",
        "location": "Lokasi baru",
        "classroom": "Ruang baru (khusus mengajar)",
        "title": "Judul baru"
      },
      "reply": "Pesan konfirmasi ramah detail perubahan."
    }
    Kosongkan document_id ("") jika tidak ketemu.
    `;

    const result = await generateWithFallback(prompt);
    const cleanJson = (await result.response).text().replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);
        const validCollections = ['teaching_schedules', 'events', 'tasks', 'consultations'];

        if (!aiData.document_id || !validCollections.includes(aiData.collection)) {
            return {
                status: 'success',
                reply: `Maaf, jadwal yang ingin Anda ubah tidak ditemukan di database Anda.\n\n🤖 *Lecturo Assistant*`
            };
        }

        const docRef = userRef.collection(aiData.collection).doc(aiData.document_id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return {
                status: 'success',
                reply: `Maaf, jadwal tersebut sudah tidak ada di database.\n\n🤖 *Lecturo Assistant*`
            };
        }

        const currentData = docSnap.data();
        const fields = aiData.updated_fields || {};

        if (aiData.collection === 'teaching_schedules') {
            if (fields.title) { fields.course_name = fields.title; delete fields.title; }
            if (fields.location && !fields.classroom) { fields.classroom = fields.location; delete fields.location; }
            if (fields.time && !fields.start_time) { fields.start_time = fields.time; delete fields.time; }
        } else if (aiData.collection === 'consultations') {
            if (fields.time && !fields.start_time) { fields.start_time = fields.time; delete fields.time; }
        } else {
            if (fields.start_time && !fields.time) { fields.time = fields.start_time; delete fields.start_time; }
        }

        const effectiveDate = fields.date || currentData.date;
        const effectiveStartTime = fields.start_time || fields.time || currentData.start_time || currentData.time || "08:00";
        let effectiveEndTime = fields.end_time || currentData.end_time;

        if ((fields.start_time || fields.time) && !fields.end_time) {
            effectiveEndTime = calculateProportionalEndTime(
                currentData.start_time || currentData.time,
                currentData.end_time,
                effectiveStartTime
            );
            fields.end_time = effectiveEndTime;
        }

        const targetTitle = currentData.course_name || currentData.title || "Jadwal";
        const conflicts = await checkScheduleConflict(userRef, effectiveDate, effectiveStartTime, effectiveEndTime, aiData.document_id);

        if (conflicts.length > 0) {
            return {
                status: 'success',
                reply: buildConflictMessage(conflicts, targetTitle, effectiveDate, effectiveStartTime, effectiveEndTime, true)
            };
        }

        const finalUpdatePayload = { updated_at: new Date().toISOString() };
        for (const k in fields) {
            if (fields[k] !== undefined && fields[k] !== null && fields[k] !== "") {
                finalUpdatePayload[k] = fields[k];
            }
        }

        await docRef.update(finalUpdatePayload);
        console.log(`✅ Berhasil update jadwal [${aiData.document_id}]`);

        return { status: 'success', reply: `${aiData.reply}\n\n🤖 *Lecturo Assistant*` };

    } catch (e) {
        console.error("Gagal parse Update:", e);
        return {
            status: 'error',
            reply: `Maaf, saya mengalami kesulitan memproses perubahan jadwal tersebut. Mohon ulangi instruksi Anda dengan lebih jelas.\n\n🤖 *Lecturo Assistant*`
        };
    }
};

/**
 * 4. DELETE SCHEDULE (Tahap 1: Tanya Konfirmasi)
 */
const processDeleteSchedule = async (userRef, message) => {
    console.log("🔍 [PENCARIAN DB] Mengambil jadwal aktif untuk target hapus...");

    const [teachingSnap, eventSnap, taskSnap, consultationSnap] = await Promise.all([
        userRef.collection('teaching_schedules').where('is_completed', '==', false).get(),
        userRef.collection('events').where('is_completed', '==', false).get(),
        userRef.collection('tasks').where('is_completed', '==', false).get(),
        userRef.collection('consultations').where('status', '==', 'SCHEDULED').get()
    ]);

    const contextData = `
    A. JADWAL MENGAJAR:\n${formatTeaching(teachingSnap)}
    B. EVENT / ACARA:\n${formatEvents(eventSnap)}
    C. TUGAS / TASKS:\n${formatTasks(taskSnap)}
    D. KONSULTASI:\n${formatConsultations(consultationSnap)}
    `;

    const prompt = `
    Pesan user: "${message}"
    Berikut jadwal aktif:
    ${contextData}

    Tugas: Cari ID jadwal yang mau dihapus. Wajib format JSON murni:
    {
      "document_id": "ID_DB",
      "collection": "teaching_schedules ATAU events ATAU tasks ATAU consultations",
      "reply": "Pesan konfirmasi"
    }
    Kosongkan document_id jika tidak ketemu.
    `;

    const result = await generateWithFallback(prompt);
    const cleanJson = (await result.response).text().replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
        const aiData = JSON.parse(cleanJson);
        const validCollections = ['teaching_schedules', 'events', 'tasks', 'consultations'];

        if (aiData.document_id && validCollections.includes(aiData.collection)) {
            const docRef = userRef.collection(aiData.collection).doc(aiData.document_id);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                return {
                    status: 'success',
                    reply: `Maaf, jadwal tersebut sudah tidak ditemukan di database Anda.\n\n🤖 *Lecturo Assistant*`
                };
            }

            const data = docSnap.data();
            const scheduleTitle = data.course_name || data.title || "Agenda";
            const scheduleDate = data.date || "-";
            const scheduleTime = data.start_time || data.time || "-";
            const scheduleEnd = data.end_time ? ` - ${data.end_time}` : "";

            pendingDeleteMap.set(userRef.id, {
                docId: aiData.document_id,
                collection: aiData.collection,
                title: scheduleTitle,
                date: scheduleDate,
                time: `${scheduleTime}${scheduleEnd}`,
                expiresAt: Date.now() + 2 * 60 * 1000
            });

            const confirmMessage =
                `⚠️ *KONFIRMASI PENGHAPUSAN JADWAL*\n\n` +
                `Apakah Anda yakin ingin menghapus agenda berikut?\n` +
                `📌 *${scheduleTitle}*\n` +
                `📅 Tanggal: ${scheduleDate}\n` +
                `⏰ Waktu: ${scheduleTime}${scheduleEnd}\n\n` +
                `Ketik *YA* untuk menghapus secara permanen, atau *BATAL* untuk membatalkan (berlaku 2 menit).`;

            return { status: 'success', reply: `${confirmMessage}\n\n🤖 *Lecturo Assistant*` };
        }

        return {
            status: 'success',
            reply: `Maaf, jadwal tersebut tidak ditemukan di database Anda.\n\n🤖 *Lecturo Assistant*`
        };

    } catch (e) {
        console.error("Gagal parse Delete:", e);
        return {
            status: 'error',
            reply: `Maaf, saya gagal memproses permintaan hapus Anda.\n\n🤖 *Lecturo Assistant*`
        };
    }
};

module.exports = {
    handlePendingDelete,
    processReadSchedule,
    processCreateSchedule,
    processUpdateSchedule,
    processDeleteSchedule
};