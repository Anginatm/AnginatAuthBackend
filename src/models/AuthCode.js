const mongoose = require('mongoose');

const authCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Code is required'],
      unique: true,
      trim: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: [true, 'Brand is required'],
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    // Optional: track first verification
    firstVerifiedAt: {
      type: Date,
    },
    verifyCount: {
      type: Number,
      default: 0,
    },
    qrCodeUrl: {
      type: String,
      sparse: true,
    },
  },
  { timestamps: true }
);

// Compound index for faster lookups
authCodeSchema.index({ code: 1, status: 1 });
authCodeSchema.index({ brand: 1, status: 1 });

module.exports = mongoose.model('AuthCode', authCodeSchema);
