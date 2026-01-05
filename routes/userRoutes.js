const express = require('express');
const router = express.Router();
const { syncUser, getUser } = require('../controllers/userController');

// Endpoint: POST /api/users/sync
router.post('/sync', syncUser);

// Rute Get User (GET) <-- TAMBAHKAN INI
router.get('/:uid', getUser);

module.exports = router;