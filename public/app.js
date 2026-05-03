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
// 2. LOGIKA PORTAL MAHASISWA (REAL FETCH API)
// ==========================================
const searchInput = document.getElementById('searchDosen');
const searchResults = document.getElementById('searchResults');
const scheduleDisplay = document.getElementById('schedule-display');
const timelineContainer = document.getElementById('timelineContainer');
const datePicker = document.getElementById('scheduleDate');
let currentDosenId = null;

if (datePicker) {
    datePicker.valueAsDate = new Date();
    datePicker.addEventListener('change', () => {
        if (currentDosenId) renderTimeline(currentDosenId, datePicker.value);
    });
}

if (searchInput) {
    searchInput.addEventListener('input', async function () {
        const keyword = this.value.toLowerCase();
        searchResults.innerHTML = '';

        if (keyword.length < 3) return; // Mencegah spam request, mulai cari setelah 3 huruf

        try {
            // PERHATIAN: Kamu harus membuat endpoint GET /api/dosen/search?q=keyword di Node.js kamu
            const response = await fetch(`/api/portal/search-dosen?q=${keyword}`);
            const result = await response.json();

            if (response.ok && result.data && result.data.length > 0) {
                result.data.forEach(dosen => {
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    div.innerHTML = `<strong>${dosen.name}</strong><span>${dosen.univ || 'Dosen Lecturo'}</span>`;
                    div.onclick = () => selectDosen(dosen);
                    searchResults.appendChild(div);
                });
            } else {
                searchResults.innerHTML = '<div class="search-item"><span>Tidak ditemukan</span></div>';
            }
        } catch (error) {
            console.error("Gagal mencari data dosen", error);
            searchResults.innerHTML = '<div class="search-item"><span style="color:red;">Error server. Belum ada API.</span></div>';
        }
    });
}

function selectDosen(dosen) {
    searchInput.value = dosen.name;
    searchResults.innerHTML = '';
    currentDosenId = dosen.uid; // Gunakan UID dari firestore

    document.getElementById('displayDosenName').innerText = dosen.name;
    document.getElementById('displayDosenUniv').innerText = dosen.univ || 'Dosen Lecturo';
    scheduleDisplay.style.display = 'block';

    renderTimeline(currentDosenId, datePicker.value);
}

// Timpa hanya function renderTimeline ini di file app.js kamu:

async function renderTimeline(dosenId, dateStr) {
    timelineContainer.innerHTML = '<div style="text-align:center; width:100%; padding: 20px;">Loading data dari Firestore...</div>';

    try {
        const response = await fetch(`/api/portal/timeline?uid=${dosenId}&date=${dateStr}`);
        const result = await response.json();

        const scheduleData = response.ok && result.data ? result.data : [];
        timelineContainer.innerHTML = ''; // Bersihkan loading

        // Buat struktur Vertical Timeline
        const wrapper = document.createElement('div');
        wrapper.className = 'vertical-timeline';

        if (scheduleData.length === 0) {
            timelineContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: #7f8c8d;">Tidak ada jadwal di tanggal ini.</div>';
            return;
        }

        // Loop data dan buat elemen vertikal
        scheduleData.forEach(block => {
            const item = document.createElement('div');
            item.className = 'v-timeline-item';

            // Mapping Warna & Icon berdasarkan tipe
            let statusClass = 'status-free';
            let bgClass = 'bg-free';
            let icon = '☕';

            if (block.type === 'busy') {
                statusClass = 'status-busy';
                bgClass = 'bg-busy';
                icon = '👨‍🏫';
            } else if (block.type === 'consult') {
                statusClass = 'status-consult';
                bgClass = 'bg-consult';
                icon = '💬';
            }

            item.innerHTML = `
                <div class="v-time-col">
                    <span class="v-time-start">${block.startStr}</span>
                    <span class="v-time-end">${block.endStr}</span>
                </div>
                <div class="v-divider-col">
                    <div class="v-line"></div>
                    <div class="v-dot ${bgClass}">${icon}</div>
                </div>
                <div class="v-content-col">
                    <div class="v-card ${statusClass}">
                        <h4>${block.title}</h4>
                        <p>⏱️ Durasi: ${block.durationMins} Menit</p>
                    </div>
                </div>
            `;
            wrapper.appendChild(item);
        });

        timelineContainer.appendChild(wrapper);

    } catch (error) {
        console.error("Gagal memuat jadwal", error);
        timelineContainer.innerHTML = '<div style="text-align:center; color:red; width:100%; padding:20px;">Gagal mengambil data dari server.</div>';
    }
}

// ==========================================
// 3. LOGIKA PORTAL DOSEN (KODE LAMA PERSIS)
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
        showLecturerPortal();
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

document.getElementById('section-login').addEventListener('submit', function (e) {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    hideAlert();
    openModal(phone);
});

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