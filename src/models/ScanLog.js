const mongoose = require('mongoose');

const scanLogSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      index: true,
    },
    authToken: {
      type: String,
      required: true,
      index: true,
    },
    // Result of the scan
    result: {
      type: String,
      enum: ['genuine', 'already_verified', 'suspicious', 'not_found', 'revoked', 'expired'],
      required: true,
    },
    isFirstScan: {
      type: Boolean,
      default: false,
    },
    scanNumber: {
      type: Number,
      default: 1,
    },
    // Client information
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    // Location data
    location: {
      country: String,
      countryCode: String,
      city: String,
      region: String,
      latitude: Number,
      longitude: Number,
      timezone: String,
    },
    // Device info (if available)
    device: {
      type: String,
      browser: String,
      os: String,
      isMobile: Boolean,
    },
    // Suspicious activity flags
    flags: [{
      type: String,
      enum: [
        'high_velocity',           // Too many scans in short time
        'geographic_anomaly',      // Scanned in different location than usual
        'vpn_detected',            // Scan came from VPN/proxy
        'bot_suspected',           // Automated scan detected
        'duplicate_ip',            // Same IP scanning multiple products
      ],
    }],
    // Reference URL (where the scan originated from, if available)
    referrer: {
      type: String,
    },
    // Response time (for monitoring)
    responseTimeMs: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for analytics queries
scanLogSchema.index({ createdAt: -1 });
scanLogSchema.index({ brand: 1, createdAt: -1 });
scanLogSchema.index({ product: 1, createdAt: -1 });
scanLogSchema.index({ result: 1, createdAt: -1 });
scanLogSchema.index({ 'location.country': 1, createdAt: -1 });
scanLogSchema.index({ ipAddress: 1, createdAt: -1 });

// TTL index - automatically delete logs after 1 year (optional, adjust as needed)
// scanLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Static method to check for suspicious patterns
scanLogSchema.statics.checkSuspiciousActivity = async function (authToken, currentData = {}) {
  const flags = [];
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Check velocity - more than 10 scans in last hour
  const recentScans = await this.countDocuments({
    authToken,
    createdAt: { $gte: oneHourAgo },
  });
  
  if (recentScans > 10) {
    flags.push('high_velocity');
  }
  
  // Check geographic anomaly
  if (currentData.location?.country) {
    const lastScan = await this.findOne({
      authToken,
      'location.country': { $exists: true },
    }).sort({ createdAt: -1 });
    
    if (lastScan && lastScan.location?.country !== currentData.location.country) {
      const timeDiff = Date.now() - new Date(lastScan.createdAt).getTime();
      // If different country within 24 hours
      if (timeDiff < 24 * 60 * 60 * 1000) {
        flags.push('geographic_anomaly');
      }
    }
  }
  
  // Check for same IP scanning multiple products
  if (currentData.ipAddress) {
    const ipScans = await this.countDocuments({
      ipAddress: currentData.ipAddress,
      createdAt: { $gte: oneDayAgo },
    });
    
    if (ipScans > 50) {
      flags.push('duplicate_ip');
    }
  }
  
  return flags;
};

// Static method to get analytics summary
scanLogSchema.statics.getAnalytics = async function (brandId, startDate, endDate) {
  const match = { brand: brandId };
  
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }
  
  const [summary, byResult, byCountry, byDay] = await Promise.all([
    // Overall summary
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalScans: { $sum: 1 },
          uniqueProducts: { $addToSet: '$product' },
          genuineScans: {
            $sum: { $cond: [{ $eq: ['$result', 'genuine'] }, 1, 0] },
          },
          suspiciousScans: {
            $sum: { $cond: [{ $in: ['$result', ['suspicious', 'not_found']] }, 1, 0] },
          },
        },
      },
    ]),
    
    // By result type
    this.aggregate([
      { $match: match },
      { $group: { _id: '$result', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    
    // By country
    this.aggregate([
      { $match: { ...match, 'location.country': { $exists: true } } },
      { $group: { _id: '$location.country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    
    // By day (last 30 days)
    this.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
  ]);
  
  return {
    summary: summary[0] || { totalScans: 0, genuineScans: 0, suspiciousScans: 0 },
    byResult,
    byCountry,
    byDay,
  };
};

module.exports = mongoose.model('ScanLog', scanLogSchema);
