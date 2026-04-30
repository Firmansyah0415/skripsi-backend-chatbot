// routes/portalRoutes.js
const express = require('express');
const router = express.Router();
const portalController = require('../controllers/portalController');

// Rute untuk Portal Mahasiswa
router.get('/search-dosen', portalController.searchDosen);
router.get('/timeline', portalController.getTimeline);

module.exports = router;