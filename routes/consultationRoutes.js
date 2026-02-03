const express = require('express');
const router = express.Router();
const {
    syncConsultation,
    getAllConsultations,
    deleteConsultation
} = require('../controllers/consultationController');

// POST: /api/consultation/sync
router.post('/sync', syncConsultation);

// GET: /api/consultation/:uid
router.get('/:uid', getAllConsultations);

// DELETE: /api/consultation/:uid/:consultationId
router.delete('/:uid/:consultationId', deleteConsultation);

module.exports = router;