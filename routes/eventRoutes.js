const express = require('express');
const router = express.Router();
const { syncEvent, getAllEvents, deleteEvent } = require('../controllers/eventController');

router.post('/sync', syncEvent);
router.get('/:uid', getAllEvents);
router.delete('/:uid/:eventId', deleteEvent);

module.exports = router;