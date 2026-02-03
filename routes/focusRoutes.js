const express = require('express');
const router = express.Router();
const focusController = require('../controllers/focusController');

// Route: /api/focus
router.post('/sync', focusController.syncSession);
router.get('/:uid', focusController.getAllSessions);
router.delete('/:uid/:sessionId', focusController.deleteSession);

module.exports = router;