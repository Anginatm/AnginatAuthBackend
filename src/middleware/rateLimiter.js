const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const ApiResponse = require('../utils/apiResponse');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return ApiResponse.tooManyRequests(res, 'Too many requests. Please try again later.');
  },
});

/**
 * Strict rate limiter for verification endpoint
 */
const verifyLimiter = rateLimit({
  windowMs: config.verifyRateLimitWindowMs,
  max: config.verifyRateLimitMax,
  message: {
    success: false,
    message: 'Too many verification requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    // Properly handle IPv6 addresses using the helper function
    const ip = ipKeyGenerator(req, res);
    return `${ip}-${req.headers['user-agent'] || 'unknown'}`;
  },
  handler: (req, res) => {
    return ApiResponse.tooManyRequests(res, 'Too many verification requests. Please try again later.');
  },
});

/**
 * Auth rate limiter (stricter for login/register)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return ApiResponse.tooManyRequests(res, 'Too many authentication attempts. Please try again in 15 minutes.');
  },
});

/**
 * Upload rate limiter
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: {
    success: false,
    message: 'Too many file uploads, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return ApiResponse.tooManyRequests(res, 'Too many file uploads. Please try again later.');
  },
});

module.exports = {
  apiLimiter,
  verifyLimiter,
  authLimiter,
  uploadLimiter,
};
