const express = require('express');
const router = express.Router();
const { syncTask, getAllTasks, deleteTask } = require('../controllers/taskController');

router.post('/sync', syncTask);
router.get('/:uid', getAllTasks);
router.delete('/:uid/:taskId', deleteTask);

module.exports = router;