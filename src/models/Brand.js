const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      trim: true,
    },
    logo: {
      type: String, // URL to logo
    },
    description: {
      type: String,
    },
    website: {
      type: String,
    },
    contactEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    contactPhone: {
      type: String,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    totalCodes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

brandSchema.index({ name: 1 });
brandSchema.index({ status: 1 });

module.exports = mongoose.model('Brand', brandSchema);
