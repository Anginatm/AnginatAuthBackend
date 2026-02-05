const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/brands', require('./brands'));
router.use('/codes', require('./codes'));
router.use('/verify', require('./verify'));
router.use('/products', require('./products'));

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API is running', timestamp: new Date().toISOString() });
});

module.exports = router;
