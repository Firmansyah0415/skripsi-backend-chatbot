const express = require('express');
const multer = require('multer');
const { uploadScheduleCSV } = require('../controllers/uploadController');

const router = express.Router();

// Setup Multer untuk menyimpan file ke folder 'uploads/'
const upload = multer({ dest: 'uploads/' });

// Endpoint API kita
router.post('/csv', upload.single('file_jadwal'), uploadScheduleCSV);

module.exports = router;