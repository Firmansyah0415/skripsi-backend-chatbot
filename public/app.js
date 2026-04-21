let currentUserPhone = "";
let currentUserUid = "";
const alertBox = document.getElementById('alert');
const mainCard = document.getElementById('mainCard');

function showAlert(msg, isError = false) {
    alertBox.style.display = 'block';
    alertBox.className = isError ? 'alert-error' : 'alert-success';
    alertBox.innerHTML = msg;
}

function hideAlert() { alertBox.style.display = 'none'; }

// FUNGSI BARU: Langsung melompat ke halaman Upload
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
    // Hapus data dari brankas browser saat logout
    localStorage.removeItem('lecturo_uid');

    currentUserPhone = "";
    currentUserUid = "";
    document.getElementById('phone').value = "";
    document.getElementById('otp').value = "";
    document.getElementById('file_jadwal').value = "";
    resetToLogin();
}

// FUNGSI BARU: Cek LocalStorage saat halaman pertama kali dimuat
window.onload = function () {
    const savedUid = localStorage.getItem('lecturo_uid');
    if (savedUid) {
        // Jika UID ada di brankas, langsung bypass ke halaman upload
        currentUserUid = savedUid;
        showUploadSection();
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
// LOGIKA MODAL POPUP (BARU)
// ==========================================
const confirmModal = document.getElementById('confirmModal');
const confirmPhoneNumber = document.getElementById('confirmPhoneNumber');
const btnConfirmSend = document.getElementById('btnConfirmSend');
let pendingPhoneNumber = "";

function openModal(phone) {
    pendingPhoneNumber = phone;
    confirmPhoneNumber.innerText = phone;
    confirmModal.style.display = 'flex'; // Munculkan popup
}

function closeModal() {
    confirmModal.style.display = 'none'; // Sembunyikan popup
}

// 1. CEGAT FORM LOGIN (Tampilkan Popup)
document.getElementById('section-login').addEventListener('submit', function (e) {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    hideAlert();
    openModal(phone); // Buka popup konfirmasi
});

// 2. EKSEKUSI API SETELAH DIKONFIRMASI
btnConfirmSend.addEventListener('click', async function () {
    closeModal(); // Tutup popup

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
            // Tampilkan pesan error dari Backend (misal: "Nomor belum terdaftar")
            showAlert(`<strong>Ditolak:</strong> ${result.message}`, true);
        }
    } catch (error) {
        showAlert("Gagal terhubung ke server. Coba lagi.", true);
    } finally {
        btn.disabled = false;
        btn.innerText = "Kirim OTP ke WhatsApp";
    }
});

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

            // SIMPAN UID KE DALAM BRANKAS BROWSER
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