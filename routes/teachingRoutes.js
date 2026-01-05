// routes/teachingRoutes.js
const express = require('express');
const router = express.Router();
const { syncTeaching, getTeachings, deleteTeaching } = require('../controllers/teachingController');

// POST: http://IP_LAPTOP:3000/api/teachings/sync
router.post('/sync', syncTeaching);

// GET: http://IP_LAPTOP:3000/api/teachings/:uid
router.get('/:uid', getTeachings);

// DELETE: http://IP_LAPTOP:3000/api/teachings/:uid/:scheduleId
router.delete('/:uid/:scheduleId', deleteTeaching);

module.exports = router; 