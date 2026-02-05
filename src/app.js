const express = require('express');
const cors = require('cors');
const config = require('./config');
const routes = require('./routes');

const app = express();

// CORS
app.use(cors({ origin: config.corsOrigins, credentials: true }));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// Root
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Anginat Auth API',
    version: '1.0.0',
    endpoints: {
      verify: 'GET /api/verify/:code',
      health: 'GET /api/health',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

module.exports = app;
