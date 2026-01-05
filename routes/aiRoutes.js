const express = require('express');
const router = express.Router();
const { chatWithGemini, extractEvent } = require('../controllers/aiController');

// Endpoint untuk Chatbot
router.post('/chat', chatWithGemini);

// Endpoint KHUSUS untuk Ekstraksi Event (OCR)
// URL nanti: http://localhost:3000/api/ai/event
router.post('/event', extractEvent);

module.exports = router;