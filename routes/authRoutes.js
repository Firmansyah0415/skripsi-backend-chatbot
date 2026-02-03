const express = require('express');
const router = express.Router();
const { requestOtp, verifyOtp } = require('../controllers/authController');

// Endpoint: POST /api/auth/request-otp
router.post('/request-otp', requestOtp);

// Endpoint: POST /api/auth/verify-otp
router.post('/verify-otp', verifyOtp);

module.exports = router;