// ==========================================
// 1. IMPORTS (Third Party & Local Modules)
// ==========================================
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Import Routes
const authRoutes = require('./routes/authRoutes'); // <--- Tambah ini
const aiRoutes = require('./routes/aiRoutes');
const userRoutes = require('./routes/userRoutes');
const teachingRoutes = require('./routes/teachingRoutes');
const eventRoutes = require('./routes/eventRoutes');
const taskRoutes = require('./routes/taskRoutes');
const consultationRoutes = require('./routes/consultationRoutes');
const consultationPatternRoutes = require('./routes/consultationPatternRoutes');
const focusRoutes = require('./routes/focusRoutes');

// Import Controllers/Services
const { startWhatsAppBot } = require('./controllers/whatsappClient');

// ==========================================
// 2. APP CONFIGURATION
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Agar bisa diakses dari berbagai origin
app.use(bodyParser.json()); // Agar bisa membaca format JSON

// ==========================================
// 3. REGISTER ROUTES
// ==========================================
app.use('/api/auth', authRoutes); // <--- Tambah ini (Paling atas route biar rapi)
app.use('/api', aiRoutes);                 // Chatbot & AI Tools
app.use('/api/users', userRoutes);         // User Management
app.use('/api/teachings', teachingRoutes); // Jadwal Mengajar
app.use('/api/events', eventRoutes);       // Jadwal Event/Acara
app.use('/api/tasks', taskRoutes);         // Jadwal Tugas
app.use('/api/consultation', consultationRoutes); // Jadwal Konsultasi
app.use('/api/consultation-pattern', consultationPatternRoutes); // Untuk Template Pola konsultasi
app.use('/api/focus', focusRoutes);

// Route Utama (Cek Status Server)
app.get('/', (req, res) => {
    res.send('Halo! Server Backend Skripsi "Lecturo" siap dan berjalan normal.');
});

// ==========================================
// 4. START SERVICES
// ==========================================

// Jalankan Bot WhatsApp (Scan QR di Terminal)
startWhatsAppBot();

// Jalankan Server Express
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`🚀 SERVER BERHASIL BERJALAN!`);
    console.log(`----------------------------------------`);
    console.log(`📡 Akses Lokal   : http://localhost:${PORT}`);
    console.log(`📱 Akses dari HP : Gunakan IP Laptop (Cek ipconfig)`);
    console.log(`========================================\n`);
});