const express = require('express');
const router = express.Router();
const verifyController = require('../controllers/verifyController');

// PUBLIC - No authentication required
router.get('/:code', verifyController.verify);
router.post('/', verifyController.verifyPost);

module.exports = router;
