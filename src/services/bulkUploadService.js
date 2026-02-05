const XLSX = require('xlsx');
const { parse } = require('csv-parse');
const fs = require('fs');
const QRCode = require('qrcode');
const { AuthCode, Brand, BulkUploadJob } = require('../models');
const s3Service = require('../utils/s3Service');

class BulkUploadService {
  constructor() {
    this.BATCH_SIZE = 1000; // Process 1000 codes at a time
    this.MAX_ERRORS = 100; // Store max 100 errors
  }

  /**
   * Process bulk upload file
   * @param {Object} options - { jobId, filePath, fileType, brandId, productId, userId, io }
   */
  async processBulkUpload({ jobId, filePath, fileType, brandId, productId, userId, io }) {
    let job;
    
    try {
      // Get job
      job = await BulkUploadJob.findOne({ jobId });
      if (!job) {
        throw new Error('Job not found');
      }

      // Update job status
      job.status = 'processing';
      job.summary.startTime = new Date();
      await job.save();

      // Emit progress
      this.emitProgress(io, userId, jobId, job);

      // Validate brand exists
      const brand = await Brand.findById(brandId);
      if (!brand) {
        throw new Error('Brand not found');
      }

      // Process based on file type
      let result;
      if (fileType === 'csv') {
        result = await this.processCSV(filePath, brandId, productId, job, io, userId);
      } else if (fileType === 'xlsx') {
        result = await this.processExcel(filePath, brandId, productId, job, io, userId);
      } else {
        throw new Error('Unsupported file type');
      }

      // Update brand total codes
      await Brand.findByIdAndUpdate(brandId, {
        $inc: { totalCodes: result.successful },
      });

      // Complete job
      job.status = 'completed';
      job.summary.endTime = new Date();
      job.summary.duration = job.summary.endTime - job.summary.startTime;
      job.summary.avgProcessingSpeed = Math.round(
        result.processed / (job.summary.duration / 1000)
      );
      await job.save();

      // Emit final progress
      this.emitProgress(io, userId, jobId, job);

      // Cleanup file
      this.cleanupFile(filePath);

      return result;
    } catch (error) {
      console.error('Bulk upload error:', error);

      if (job) {
        job.status = 'failed';
        job.summary.endTime = new Date();
        if (job.summary.startTime) {
          job.summary.duration = job.summary.endTime - job.summary.startTime;
        }
        await job.addError({
          row: 0,
          code: 'SYSTEM_ERROR',
          error: error.message,
        });
        await job.save();

        // Emit error
        this.emitProgress(io, userId, jobId, job);
      }

      // Cleanup file
      this.cleanupFile(filePath);

      throw error;
    }
  }

  /**
   * Process CSV file with streaming
   */
  async processCSV(filePath, brandId, productId, job, io, userId) {
    return new Promise(async (resolve, reject) => {
      const codes = [];
      const errors = [];
      let rowNumber = 0;
      let processedCount = 0;
      let successfulCount = 0;
      let failedCount = 0;
      let duplicatesCount = 0;

      const parser = fs.createReadStream(filePath).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      );

      parser.on('data', (row) => {
        rowNumber++;
        
        try {
          const code = this.extractCode(row);
          
          if (!code) {
            errors.push({ row: rowNumber, code: '', error: 'Empty or missing code' });
            failedCount++;
          } else {
            codes.push({ code, rowNumber });
          }

          // Process batch when size reached
          if (codes.length >= this.BATCH_SIZE) {
            parser.pause();
            this.processBatch(codes, brandId, productId, job, errors, io, userId)
              .then((stats) => {
                processedCount += stats.processed;
                successfulCount += stats.successful;
                failedCount += stats.failed;
                duplicatesCount += stats.duplicates;
                codes.length = 0; // Clear batch
                parser.resume();
              })
              .catch(reject);
          }
        } catch (error) {
          errors.push({ row: rowNumber, code: '', error: error.message });
          failedCount++;
        }
      });

      parser.on('end', async () => {
        try {
          // Process remaining codes
          if (codes.length > 0) {
            const stats = await this.processBatch(codes, brandId, productId, job, errors, io, userId);
            processedCount += stats.processed;
            successfulCount += stats.successful;
            failedCount += stats.failed;
            duplicatesCount += stats.duplicates;
          }

          resolve({
            processed: processedCount,
            successful: successfulCount,
            failed: failedCount,
            duplicates: duplicatesCount,
            errors: errors.slice(0, this.MAX_ERRORS),
          });
        } catch (error) {
          reject(error);
        }
      });

      parser.on('error', reject);
    });
  }

  /**
   * Process Excel file
   */
  async processExcel(filePath, brandId, productId, job, io, userId) {
    try {
      // Read workbook
      const workbook = XLSX.readFile(filePath, {
        type: 'file',
        cellDates: true,
        cellNF: false,
        cellText: false,
      });

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        raw: false,
        defval: null,
      });

      // Update total
      await job.updateProgress({ total: rows.length });
      this.emitProgress(io, userId, job.jobId, job);

      const codes = [];
      const errors = [];
      let processedCount = 0;
      let successfulCount = 0;
      let failedCount = 0;
      let duplicatesCount = 0;

      // Process in batches
      for (let i = 0; i < rows.length; i++) {
        const rowNumber = i + 2; // +2 for Excel (header + 0-index)
        
        try {
          const code = this.extractCode(rows[i]);
          
          if (!code) {
            errors.push({ row: rowNumber, code: '', error: 'Empty or missing code' });
            failedCount++;
          } else {
            codes.push({ code, rowNumber });
          }

          // Process batch
          if (codes.length >= this.BATCH_SIZE || i === rows.length - 1) {
            const stats = await this.processBatch(codes, brandId, productId, job, errors, io, userId);
            processedCount += stats.processed;
            successfulCount += stats.successful;
            failedCount += stats.failed;
            duplicatesCount += stats.duplicates;
            codes.length = 0; // Clear batch
          }
        } catch (error) {
          errors.push({ row: rowNumber, code: '', error: error.message });
          failedCount++;
        }
      }

      return {
        processed: processedCount,
        successful: successfulCount,
        failed: failedCount,
        duplicates: duplicatesCount,
        errors: errors.slice(0, this.MAX_ERRORS),
      };
    } catch (error) {
      throw new Error(`Excel processing error: ${error.message}`);
    }
  }

  /**
   * Process batch of codes
   */
  async processBatch(codes, brandId, productId, job, errors, io, userId) {
    try {
      const codeStrings = codes.map((c) => c.code);

      // Check existing codes
      const existingCodes = await AuthCode.find({
        code: { $in: codeStrings },
      }).select('code');

      const existingSet = new Set(existingCodes.map((c) => c.code));
      const newCodes = [];
      let duplicatesCount = 0;

      // Filter duplicates
      for (const item of codes) {
        if (existingSet.has(item.code)) {
          duplicatesCount++;
          errors.push({
            row: item.rowNumber,
            code: item.code,
            error: 'Duplicate code',
          });
        } else {
          const codeDoc = {
            code: item.code,
            brand: brandId,
          };
          
          // Add productId if provided
          if (productId) {
            codeDoc.product = productId;
          }
          
          newCodes.push(codeDoc);
        }
      }

      // Insert new codes
      let insertedCount = 0;
      if (newCodes.length > 0) {
        try {
          const result = await AuthCode.insertMany(newCodes, {
            ordered: false, // Continue on duplicate key errors
            writeConcern: { w: 1 },
          });
          insertedCount = result.length;
        } catch (error) {
          // Handle duplicate key errors from race conditions
          if (error.code === 11000 && error.writeErrors) {
            insertedCount = newCodes.length - error.writeErrors.length;
            duplicatesCount += error.writeErrors.length;
          } else {
            throw error;
          }
        }
      }

      // Update job progress
      const processed = codes.length;
      const successful = insertedCount;
      const failed = codes.length - insertedCount - duplicatesCount;

      await job.updateProgress({
        processed: job.progress.processed + processed,
        successful: job.progress.successful + successful,
        failed: job.progress.failed + failed,
        duplicates: job.progress.duplicates + duplicatesCount,
      });

      // Emit progress
      this.emitProgress(io, userId, job.jobId, job);

      return {
        processed,
        successful,
        failed,
        duplicates: duplicatesCount,
      };
    } catch (error) {
      throw new Error(`Batch processing error: ${error.message}`);
    }
  }

  /**
   * Extract code from row (try different column names)
   */
  extractCode(row) {
    const code =
      row.code ||
      row.Code ||
      row.CODE ||
      row.auth_code ||
      row.authCode ||
      row.AuthCode ||
      row.authentication_code ||
      row['Authentication Code'] ||
      Object.values(row)[0];

    if (!code) return null;

    const trimmed = code.toString().trim();
    
    // Validate code
    if (trimmed.length < 3 || trimmed.length > 100) {
      throw new Error('Code length must be between 3-100 characters');
    }

    return trimmed;
  }

  /**
   * Emit progress to client via Socket.io
   */
  emitProgress(io, userId, jobId, job) {
    if (io) {
      io.to(`user-${userId}`).emit('bulkUploadProgress', {
        jobId,
        status: job.status,
        progress: job.progress,
        errors: job.errors.slice(0, 10), // Send first 10 errors
      });
    }
  }

  /**
   * Cleanup uploaded file
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('File cleanup error:', error);
    }
  }
}

module.exports = new BulkUploadService();
