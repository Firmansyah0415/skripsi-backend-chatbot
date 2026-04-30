let currentUserPhone = "";
let currentUserUid = "";

const alertBox = document.getElementById('alert');
const mainCard = document.getElementById('mainCard');

// ==========================================
// 1. NAVIGASI ANTAR PORTAL (SPA)
// ==========================================
function showLecturerPortal() {
    document.getElementById('student-portal').style.display = 'none';
    document.getElementById('lecturer-portal').style.display = 'flex';
    document.getElementById('btnSwitchToLecturer').style.display = 'none';
    document.getElementById('btnSwitchToStudent').style.display = 'block';
}

function showStudentPortal() {
    document.getElementById('student-portal').style.display = 'block';
    document.getElementById('lecturer-portal').style.display = 'none';
    document.getElementById('btnSwitchToLecturer').style.display = 'block';
    document.getElementById('btnSwitchToStudent').style.display = 'none';
}

// ==========================================
// 2. LOGIKA PORTAL MAHASISWA (CARI JADWAL)
// ==========================================

// --- MOCK DATA (Ganti dengan API Firestore nanti) ---
const mockDosenData = [
    { id: "d01", name: "Dr. Firman Ardiansyah, S.T., M.Kom.", univ: "Universitas Negeri Makassar" },
    { id: "d02", name: "Prof. Budi Santoso", univ: "Universitas Hasanuddin" },
    { id: "d03", name: "Siti Aminah, M.T.", univ: "Universitas Telkom" }
];

// Data Jadwal Dummy (Format 1 jam-an untuk kemudahan visualisasi)
const mockScheduleData = {
    "d01": {
        "08:00": "busy", "09:00": "busy", "10:00": "free", "11:00": "consult",
        "12:00": "busy", "13:00": "free", "14:00": "free", "15:00": "busy",
        "16:00": "consult", "17:00": "free"
    }
};

const searchInput = document.getElementById('searchDosen');
const searchResults = document.getElementById('searchResults');
const scheduleDisplay = document.getElementById('schedule-display');
const timelineContainer = document.getElementById('timelineContainer');
const datePicker = document.getElementById('scheduleDate');

if (datePicker) datePicker.valueAsDate = new Date();

if (searchInput) {
    searchInput.addEventListener('input', function () {
        const keyword = this.value.toLowerCase();
        searchResults.innerHTML = '';

        if (keyword.length < 2) return;

        const filtered = mockDosenData.filter(d => d.name.toLowerCase().includes(keyword));

        filtered.forEach(dosen => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<strong>${dosen.name}</strong><span>${dosen.univ}</span>`;
            div.onclick = () => selectDosen(dosen);
            searchResults.appendChild(div);
        });
    });
}

function selectDosen(dosen) {
    searchInput.value = dosen.name;
    searchResults.innerHTML = '';

    document.getElementById('displayDosenName').innerText = dosen.name;
    document.getElementById('displayDosenUniv').innerText = dosen.univ;
    scheduleDisplay.style.display = 'block';

    renderTimeline(dosen.id);
}

function renderTimeline(dosenId) {
    timelineContainer.innerHTML = '';
    const schedule = mockScheduleData[dosenId] || {};

    for (let i = 8; i <= 17; i++) {
        const timeKey = `${i < 10 ? '0' + i : i}:00`;
        const endKey = `${i + 1 < 10 ? '0' + (i + 1) : (i + 1)}:00`;

        const status = schedule[timeKey] || 'free';

        let statusText, cssClass;
        if (status === 'free') {
            statusText = "Waktu Luang"; cssClass = "slot-free";
        } else if (status === 'consult') {
            statusText = "Bimbingan"; cssClass = "slot-consult";
        } else {
            statusText = "Sibuk"; cssClass = "slot-busy";
        }

        const slotDiv = document.createElement('div');
        slotDiv.className = `time-slot ${cssClass}`;
        slotDiv.innerHTML = `<span class="time-label">${timeKey} - ${endKey}</span><span>${statusText}</span>`;

        timelineContainer.appendChild(slotDiv);
    }
}

// ==========================================
// 3. LOGIKA PORTAL DOSEN (UI & UTILS)
// ==========================================

function showAlert(msg, isError = false) {
    alertBox.style.display = 'block';
    alertBox.className = isError ? 'alert-error' : 'alert-success';
    alertBox.innerHTML = msg;
}

function hideAlert() { alertBox.style.display = 'none'; }

function showUploadSection() {
    hideAlert();
    document.getElementById('section-login').style.display = 'none';
    document.getElementById('section-otp').style.display = 'none';
    document.getElementById('section-upload').style.display = 'block';
    document.getElementById('form-subtitle').innerText = "Portal Upload Jadwal CSV";
    mainCard.classList.add('expanded');
}

function resetToLogin() {
    document.getElementById('section-login').style.display = 'block';
    document.getElementById('section-otp').style.display = 'none';
    document.getElementById('section-upload').style.display = 'none';
    document.getElementById('form-subtitle').innerText = "Login Dosen (Via WhatsApp)";
    mainCard.classList.remove('expanded');
    hideAlert();
}

function logout() {
    localStorage.removeItem('lecturo_uid');
    currentUserPhone = "";
    currentUserUid = "";
    document.getElementById('phone').value = "";
    document.getElementById('otp').value = "";
    document.getElementById('file_jadwal').value = "";
    resetToLogin();
}

window.onload = function () {
    const savedUid = localStorage.getItem('lecturo_uid');
    if (savedUid) {
        currentUserUid = savedUid;
        showLecturerPortal(); // Langsung tampilkan UI Dosen
        showUploadSection();  // Langsung masuk halaman upload
    }
};

function downloadTemplate() {
    const csvHeader = "tipe_jadwal,judul,tanggal,waktu_mulai,waktu_selesai,lokasi,deskripsi,kategori_event,kode_kelas,hari,jml_mhs,prioritas,pengingat\n";
    const sampleData = "tugas,Periksa Laporan Bab 1,2026-03-15,09:00,,Ruang Dosen,Cek margin dan sitasi,,,,,Sedang,30\n" +
        "mengajar,Pemrograman Mobile,2026-03-16,13:00,15:00,Lab Komputer 1,,,IF123,Senin,40,High,15\n" +
        "event,Seminar AI Nasional,2026-03-20,08:00,,Aula Utama,Pembicara dari Google,Akademik,,,,Sedang,60\n" +
        "konsultasi,Bimbingan Skripsi,2026-03-21,10:00,11:30,Ruang Dosen,Bawa draft revisi bab 3,,,,,Medium,15";

    const blob = new Blob([csvHeader + sampleData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "Template_Jadwal_Lecturo.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// 4. LOGIKA MODAL POPUP & API FETCH LAMA
// ==========================================
const confirmModal = document.getElementById('confirmModal');
const confirmPhoneNumber = document.getElementById('confirmPhoneNumber');
const btnConfirmSend = document.getElementById('btnConfirmSend');
let pendingPhoneNumber = "";

function openModal(phone) {
    pendingPhoneNumber = phone;
    confirmPhoneNumber.innerText = phone;
    confirmModal.style.display = 'flex';
}

function closeModal() {
    confirmModal.style.display = 'none';
}

// CEGAT FORM LOGIN (Tampilkan Popup)
document.getElementById('section-login').addEventListener('submit', function (e) {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    hideAlert();
    openModal(phone);
});

// EKSEKUSI API REQUEST OTP SETELAH DIKONFIRMASI
btnConfirmSend.addEventListener('click', async function () {
    closeModal();

    const btn = document.getElementById('btnRequestOtp');
    btn.disabled = true;
    btn.innerText = "Mengecek Nomor...";

    try {
        const response = await fetch('/api/auth/request-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone_number: pendingPhoneNumber, source: 'web' })
        });
        const result = await response.json();

        if (response.ok && result.status === 'success') {
            currentUserPhone = pendingPhoneNumber;
            showAlert("OTP berhasil dikirim ke WhatsApp Anda.");
            document.getElementById('section-login').style.display = 'none';
            document.getElementById('section-otp').style.display = 'block';
            document.getElementById('form-subtitle').innerText = "Verifikasi Kode OTP";
        } else {
            showAlert(`<strong>Ditolak:</strong> ${result.message}`, true);
        }
    } catch (error) {
        showAlert("Gagal terhubung ke server. Coba lagi.", true);
    } finally {
        btn.disabled = false;
        btn.innerText = "Kirim OTP ke WhatsApp";
    }
});

// EKSEKUSI API VERIFY OTP
document.getElementById('section-otp').addEventListener('submit', async function (e) {
    e.preventDefault();
    const otpCode = document.getElementById('otp').value;
    const btn = document.getElementById('btnVerifyOtp');
    btn.disabled = true; btn.innerText = "Memverifikasi..."; hideAlert();

    try {
        const response = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone_number: currentUserPhone, otp_code: otpCode })
        });
        const result = await response.json();

        if (response.ok && result.status === 'success') {
            currentUserUid = result.uid;
            localStorage.setItem('lecturo_uid', result.uid);
            showUploadSection();
        } else {
            showAlert(result.message || "Kode OTP Salah.", true);
        }
    } catch (error) {
        showAlert("Gagal memverifikasi OTP.", true);
    } finally {
        btn.disabled = false; btn.innerText = "Verifikasi Login";
    }
});

// EKSEKUSI API UPLOAD CSV
document.getElementById('uploadForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('btnUpload');
    const fileInput = document.getElementById('file_jadwal').files[0];
    btn.disabled = true; btn.innerText = "Memproses Upload..."; hideAlert();

    const formData = new FormData();
    formData.append('uid', currentUserUid);
    formData.append('file_jadwal', fileInput);

    try {
        const response = await fetch('/api/upload/csv', { method: 'POST', body: formData });
        const result = await response.json();

        if (response.ok) {
            showAlert(`<strong>Sukses!</strong> ${result.message}<br>Berhasil: ${result.data_berhasil} data.<br>Gagal: ${result.data_gagal} data.`);
            document.getElementById('file_jadwal').value = "";
        } else {
            showAlert(`<strong>Gagal:</strong> ${result.error || 'Terjadi kesalahan'}`, true);
        }
    } catch (error) {
        showAlert(`<strong>Error:</strong> Gagal mengupload file.`, true);
    } finally {
        btn.disabled = false; btn.innerText = "🚀 Upload Jadwal Sekarang";
    }
});