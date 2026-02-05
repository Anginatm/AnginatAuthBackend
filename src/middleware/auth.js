const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Please login.',
      });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Please login.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(', ')}`,
      });
    }

    next();
  };
};

const checkBrandAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please login.',
    });
  }

  // Admin has access to all brands
  if (req.user.role === 'admin') {
    return next();
  }

  // Brand managers can only access their assigned brands
  if (req.user.role === 'brand_manager') {
    const brandId = req.body.brand || req.params.brand || req.query.brand;
    
    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: 'Brand ID is required',
      });
    }

    if (!req.user.brandAccess || !req.user.brandAccess.includes(brandId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this brand',
      });
    }
  }

  next();
};

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
};

module.exports = { protect, restrictTo, checkBrandAccess, generateToken };
