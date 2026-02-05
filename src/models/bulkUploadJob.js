const mongoose = require('mongoose');

const bulkUploadJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ['csv', 'xlsx'],
      required: true,
    },
    s3Key: {
      type: String, // Optional: for S3 storage
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    progress: {
      total: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      successful: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 },
    },
    errors: [
      {
        row: Number,
        code: String,
        error: String,
      },
    ],
    summary: {
      startTime: Date,
      endTime: Date,
      duration: Number, // milliseconds
      avgProcessingSpeed: Number, // codes per second
    },
    metadata: {
      batchSize: { type: Number, default: 1000 },
      maxErrors: { type: Number, default: 100 },
    },
  },
  { timestamps: true }
);

// Indexes for queries
bulkUploadJobSchema.index({ userId: 1, status: 1 });
bulkUploadJobSchema.index({ brandId: 1, status: 1 });
bulkUploadJobSchema.index({ createdAt: -1 });

// Instance method to update progress
bulkUploadJobSchema.methods.updateProgress = async function (update) {
  Object.assign(this.progress, update);
  
  if (this.progress.total > 0) {
    this.progress.percentage = Math.round(
      (this.progress.processed / this.progress.total) * 100
    );
  }
  
  return this.save();
};

// Instance method to add error
bulkUploadJobSchema.methods.addError = async function (error) {
  if (this.errors.length < this.metadata.maxErrors) {
    this.errors.push(error);
    await this.save();
  }
};

// Static method to cleanup old jobs
bulkUploadJobSchema.statics.cleanupOldJobs = async function (daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return this.deleteMany({
    status: { $in: ['completed', 'failed', 'cancelled'] },
    createdAt: { $lt: cutoffDate },
  });
};

module.exports = mongoose.model('BulkUploadJob', bulkUploadJobSchema);
