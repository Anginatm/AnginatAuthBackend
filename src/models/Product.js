const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const productSchema = new mongoose.Schema(
  {
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: [true, 'Brand is required'],
      index: true,
    },
    // Authentication token - the unique code that gets scanned
    authToken: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    // Product details
    name: {
      type: String,
      trim: true,
      maxlength: [500, 'Product name cannot exceed 500 characters'],
    },
    sku: {
      type: String,
      trim: true,
      maxlength: [100, 'SKU cannot exceed 100 characters'],
    },
    batchNumber: {
      type: String,
      trim: true,
      maxlength: [100, 'Batch number cannot exceed 100 characters'],
    },
    serialNumber: {
      type: String,
      trim: true,
      maxlength: [100, 'Serial number cannot exceed 100 characters'],
    },
    category: {
      type: String,
      trim: true,
    },
    // Dates
    manufacturingDate: {
      type: Date,
    },
    expiryDate: {
      type: Date,
    },
    // Additional metadata (flexible key-value pairs)
    metadata: {
      type: Map,
      of: String,
    },
    // Verification status
    status: {
      type: String,
      enum: ['active', 'verified', 'suspicious', 'revoked', 'expired'],
      default: 'active',
    },
    // Scan tracking
    firstScannedAt: {
      type: Date,
    },
    lastScannedAt: {
      type: Date,
    },
    scanCount: {
      type: Number,
      default: 0,
    },
    // Location of first scan
    firstScanLocation: {
      country: String,
      city: String,
      region: String,
      latitude: Number,
      longitude: Number,
    },
    // Import batch reference
    importBatch: {
      type: String,
      index: true,
    },
    // QR Code URL (stored in S3)
    qrCodeUrl: {
      type: String,
      sparse: true,
    },
    // Revocation details
    revokedAt: {
      type: Date,
    },
    revokedReason: {
      type: String,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
productSchema.index({ brand: 1, status: 1 });
productSchema.index({ brand: 1, createdAt: -1 });
productSchema.index({ brand: 1, sku: 1 });
productSchema.index({ brand: 1, batchNumber: 1 });
productSchema.index({ authToken: 1 }, { unique: true });
productSchema.index({ importBatch: 1, brand: 1 });

// Generate auth token before saving if not provided
productSchema.pre('save', function (next) {
  if (!this.authToken) {
    // Generate a 32-character cryptographically secure token
    this.authToken = nanoid(32);
  }
  next();
});

// Static method to generate bulk tokens
productSchema.statics.generateAuthToken = function () {
  return nanoid(32);
};

// Instance method to record a scan
productSchema.methods.recordScan = async function (scanData = {}) {
  const isFirstScan = this.scanCount === 0;
  
  this.scanCount += 1;
  this.lastScannedAt = new Date();
  
  if (isFirstScan) {
    this.firstScannedAt = new Date();
    this.status = 'verified';
    
    if (scanData.location) {
      this.firstScanLocation = scanData.location;
    }
  }
  
  await this.save();
  return isFirstScan;
};

// Instance method to revoke product
productSchema.methods.revoke = async function (reason, userId) {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedReason = reason;
  this.revokedBy = userId;
  await this.save();
};

// Transform output
productSchema.methods.toJSON = function () {
  const product = this.toObject();
  delete product.__v;
  return product;
};

// Virtual for verification URL
productSchema.virtual('verificationUrl').get(function () {
  const config = require('../config');
  return `${config.appUrl}/verify/${this.authToken}`;
});

module.exports = mongoose.model('Product', productSchema);
