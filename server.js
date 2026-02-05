require('dotenv').config();

const http = require('http');
const socketIo = require('socket.io');
const app = require('./src/app');
const config = require('./src/config');
const connectDB = require('./src/config/database');
const { verifyToken } = require('./src/middleware/auth');

const startServer = async () => {
  await connectDB();
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Setup Socket.io with CORS
  const io = socketIo(server, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Socket.io authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify token (reuse auth middleware logic)
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, config.jwtSecret);
      
      // Attach user to socket
      socket.userId = decoded.id;
      socket.user = decoded;
      
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Socket.io connection handling
  io.on('connection', (socket) => {
    console.log(`✅ Socket connected: ${socket.id} (User: ${socket.userId})`);
    
    // Join user-specific room for private updates
    socket.join(`user-${socket.userId}`);

    // Handle ping/pong for keepalive
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Subscribe to specific job updates
    socket.on('subscribeToJob', (jobId) => {
      socket.join(`job-${jobId}`);
      console.log(`📡 User ${socket.userId} subscribed to job ${jobId}`);
    });

    // Unsubscribe from job updates
    socket.on('unsubscribeFromJob', (jobId) => {
      socket.leave(`job-${jobId}`);
      console.log(`📴 User ${socket.userId} unsubscribed from job ${jobId}`);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`❌ Socket disconnected: ${socket.id} (${reason})`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Make io instance available to routes
  app.set('io', io);

  // Start server
  server.listen(config.port, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🛡️  Anginat Auth API v2.0                            ║
║   🚀 Bulk Upload Support (100k+ codes)                 ║
║                                                        ║
║   Port: ${config.port.toString().padEnd(45)}║
║   Environment: ${config.env.padEnd(37)}║
║   WebSocket: ✅ Enabled                                ║
║                                                        ║
║   🔹 Public Endpoints:                                 ║
║   • GET  /api/verify/:code                             ║
║   • POST /api/verify                                   ║
║                                                        ║
║   🔸 Protected Endpoints:                              ║
║   • POST /api/auth/login                               ║
║   • CRUD /api/brands                                   ║
║   • POST /api/codes/bulk-upload     (NEW)              ║
║   • GET  /api/codes/bulk-upload/:jobId                 ║
║   • GET  /api/codes/bulk-upload-jobs                   ║
║   • POST /api/codes/upload          (legacy)           ║
║   • GET  /api/codes/template/csv                       ║
║   • GET  /api/codes/template/excel                     ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
};

startServer().catch(console.error);