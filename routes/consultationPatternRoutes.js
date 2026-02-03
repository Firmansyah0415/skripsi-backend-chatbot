const express = require('express');
const router = express.Router();
const {
    syncPattern,
    getAllPatterns,
    deletePattern
} = require('../controllers/consultationPatternController');

// URL nanti: /api/consultation-pattern/sync
router.post('/sync', syncPattern);
router.get('/:uid', getAllPatterns);
router.delete('/:uid/:patternId', deletePattern);

module.exports = router;