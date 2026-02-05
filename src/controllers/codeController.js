const { parse } = require('csv-parse');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const AuthCode = require('../models/AuthCode');
const Brand = require('../models/Brand');
const bulkUploadService = require('../services/bulkUploadService');
const BulkUploadJob = require('../models/BulkUploadJob');
const s3Service = require('../utils/s3Service');

// Upload CSV of codes (Legacy - kept for backward compatibility)
exports.uploadCodes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a CSV file' });
    }

    const { brandId } = req.body;
    if (!brandId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Brand ID is required' });
    }

    // Check brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    // Parse CSV
    const codes = [];
    const errors = [];
    let rowNumber = 0;

    const parser = fs.createReadStream(req.file.path).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    for await (const row of parser) {
      rowNumber++;
      const code = row.code || row.Code || row.CODE || 
                   row.auth_code || row.authCode || row.AuthCode ||
                   row.authentication_code || Object.values(row)[0];
      
      if (code && code.trim()) {
        codes.push(code.trim());
      } else {
        errors.push({ row: rowNumber, error: 'Empty or missing code' });
      }
    }

    fs.unlinkSync(req.file.path);

    if (codes.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid codes found in CSV',
        errors 
      });
    }

    // Check for duplicates
    const existingCodes = await AuthCode.find({ code: { $in: codes } }).select('code');
    const existingSet = new Set(existingCodes.map(c => c.code));

    const newCodes = codes.filter(code => !existingSet.has(code));
    const duplicates = codes.filter(code => existingSet.has(code));

    // Insert new codes
    let insertedCount = 0;
    if (newCodes.length > 0) {
      const codeDocs = newCodes.map(code => ({ code, brand: brandId }));
      const result = await AuthCode.insertMany(codeDocs, { ordered: false });
      insertedCount = result.length;
      await Brand.findByIdAndUpdate(brandId, { $inc: { totalCodes: insertedCount } });
    }

    res.status(201).json({
      success: true,
      message: `${insertedCount} codes added successfully`,
      data: {
        total: codes.length,
        inserted: insertedCount,
        duplicates: duplicates.length,
        errors: errors.length,
      },
      duplicates: duplicates.slice(0, 10),
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// NEW: Bulk upload with background processing
exports.bulkUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please upload a file' 
      });
    }

    const { brandId, productId } = req.body;
    if (!brandId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        success: false, 
        message: 'Brand ID is required' 
      });
    }

    // Validate brand
    const brand = await Brand.findById(brandId);
    if (!brand) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    // Determine file type
    const fileType = req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')
      ? 'csv'
      : 'xlsx';

    // Create job
    const jobId = uuidv4();
    const job = await BulkUploadJob.create({
      jobId,
      userId: req.user._id,
      brandId,
      filename: req.file.originalname,
      fileType,
      status: 'pending',
    });

    // Process in background (non-blocking)
    setImmediate(() => {
      bulkUploadService.processBulkUpload({
        jobId,
        filePath: req.file.path,
        fileType,
        brandId,
        productId: productId || null,
        userId: req.user._id,
        io: req.app.get('io'), // Socket.io instance
      }).catch(error => {
        console.error('Background processing error:', error);
      });
    });

    res.status(202).json({
      success: true,
      message: 'Upload started. Processing in background.',
      data: {
        jobId,
        status: 'pending',
      },
    });
  } catch (error) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get bulk upload job status
exports.getBulkUploadStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await BulkUploadJob.findOne({ jobId })
      .populate('brandId', 'name')
      .lean();

    if (!job) {
      return res.status(404).json({ 
        success: false, 
        message: 'Job not found' 
      });
    }

    // Check ownership
    if (job.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        filename: job.filename,
        fileType: job.fileType,
        brand: job.brandId,
        progress: job.progress,
        errors: job.errors.slice(0, 50), // Return first 50 errors
        summary: job.summary,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all bulk upload jobs for user
exports.getBulkUploadJobs = async (req, res) => {
  try {
    const { status, brandId, page = 1, limit = 20 } = req.query;

    const query = { userId: req.user._id };
    if (status) query.status = status;
    if (brandId) query.brandId = brandId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [jobs, total] = await Promise.all([
      BulkUploadJob.find(query)
        .populate('brandId', 'name')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BulkUploadJob.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel bulk upload job
exports.cancelBulkUpload = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await BulkUploadJob.findOne({ jobId });

    if (!job) {
      return res.status(404).json({ 
        success: false, 
        message: 'Job not found' 
      });
    }

    // Check ownership
    if (job.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    // Can only cancel pending or processing jobs
    if (!['pending', 'processing'].includes(job.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel ${job.status} job` 
      });
    }

    job.status = 'cancelled';
    job.summary.endTime = new Date();
    if (job.summary.startTime) {
      job.summary.duration = job.summary.endTime - job.summary.startTime;
    }
    await job.save();

    res.json({
      success: true,
      message: 'Job cancelled successfully',
      data: job,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add single code
exports.addCode = async (req, res) => {
  try {
    const { code, brandId } = req.body;

    if (!code || !brandId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Code and brandId are required' 
      });
    }

    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const existing = await AuthCode.findOne({ code });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Code already exists' });
    }

    const authCode = await AuthCode.create({ code, brand: brandId });
    await Brand.findByIdAndUpdate(brandId, { $inc: { totalCodes: 1 } });

    res.status(201).json({
      success: true,
      message: 'Code added successfully',
      data: authCode,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get codes for a brand
exports.getCodes = async (req, res) => {
  try {
    const { brandId, status, search, page = 1, limit = 50 } = req.query;

    const query = {};
    if (brandId) query.brand = brandId;
    if (status) query.status = status;
    if (search) query.code = { $regex: search, $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [codes, total] = await Promise.all([
      AuthCode.find(query)
        .populate('brand', 'name')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit)),
      AuthCode.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: codes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete code
exports.deleteCode = async (req, res) => {
  try {
    const code = await AuthCode.findByIdAndDelete(req.params.id);
    if (!code) {
      return res.status(404).json({ success: false, message: 'Code not found' });
    }

    await Brand.findByIdAndUpdate(code.brand, { $inc: { totalCodes: -1 } });

    res.json({ success: true, message: 'Code deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Deactivate code
exports.deactivateCode = async (req, res) => {
  try {
    const code = await AuthCode.findByIdAndUpdate(
      req.params.id,
      { status: 'inactive' },
      { new: true }
    );
    if (!code) {
      return res.status(404).json({ success: false, message: 'Code not found' });
    }
    res.json({ success: true, message: 'Code deactivated', data: code });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Download CSV template
exports.downloadTemplate = (req, res) => {
  const template = 'code\nABC123\nXYZ789\nDEF456';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=codes-template.csv');
  res.send(template);
};

// Download Excel template
exports.downloadExcelTemplate = (req, res) => {
  const XLSX = require('xlsx');
  
  const data = [
    { code: 'ABC123' },
    { code: 'XYZ789' },
    { code: 'DEF456' },
  ];

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Codes');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=codes-template.xlsx');
  res.send(buffer);
};

// Generate QR code for authentication code
exports.generateQRCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    const frontendUrl = process.env.FRONTEND_BASE_URL;

    if (!frontendUrl) {
      return res.status(500).json({
        success: false,
        message: 'FRONTEND_BASE_URL environment variable is not set',
      });
    }

    // Fetch the auth code
    const authCode = await AuthCode.findById(codeId).populate('brand', 'name');
    if (!authCode) {
      return res.status(404).json({
        success: false,
        message: 'Auth code not found',
      });
    }

    // Generate QR code data URL with frontend URL and auth code
    const qrData = `${frontendUrl}?code=${encodeURIComponent(authCode.code)}`;
    
    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(qrData, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 1,
      width: 300,
    });

    // Upload to S3
    const fileName = `${authCode.code}-${Date.now()}.png`;
    const s3Url = await s3Service.uploadBuffer(qrBuffer, fileName, 'image/png');

    // Update auth code with QR code URL
    authCode.qrCodeUrl = s3Url;
    await authCode.save();

    res.status(201).json({
      success: true,
      message: 'QR code generated and stored successfully',
      data: {
        codeId: authCode._id,
        code: authCode.code,
        qrCodeUrl: s3Url,
        qrData,
        brand: authCode.brand,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get QR code for authentication code
exports.getQRCode = async (req, res) => {
  try {
    const { codeId } = req.params;

    const authCode = await AuthCode.findById(codeId).populate('brand', 'name');
    if (!authCode) {
      return res.status(404).json({
        success: false,
        message: 'Auth code not found',
      });
    }

    if (!authCode.qrCodeUrl) {
      return res.status(404).json({
        success: false,
        message: 'QR code not generated for this code',
      });
    }

    res.json({
      success: true,
      data: {
        codeId: authCode._id,
        code: authCode.code,
        qrCodeUrl: authCode.qrCodeUrl,
        brand: authCode.brand,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Regenerate QR code for authentication code
exports.regenerateQRCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    const frontendUrl = process.env.FRONTEND_BASE_URL;

    if (!frontendUrl) {
      return res.status(500).json({
        success: false,
        message: 'FRONTEND_BASE_URL environment variable is not set',
      });
    }

    const authCode = await AuthCode.findById(codeId).populate('brand', 'name');
    if (!authCode) {
      return res.status(404).json({
        success: false,
        message: 'Auth code not found',
      });
    }

    // Delete old QR code from S3 if it exists
    if (authCode.qrCodeUrl) {
      try {
        await s3Service.deleteFile(authCode.qrCodeUrl);
      } catch (error) {
        console.error('Error deleting old QR code:', error);
        // Continue anyway
      }
    }

    // Generate new QR code
    const qrData = `${frontendUrl}?code=${encodeURIComponent(authCode.code)}`;
    const qrBuffer = await QRCode.toBuffer(qrData, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 1,
      width: 300,
    });

    // Upload to S3
    const fileName = `${authCode.code}-${Date.now()}.png`;
    const s3Url = await s3Service.uploadBuffer(qrBuffer, fileName, 'image/png');

    // Update auth code with new QR code URL
    authCode.qrCodeUrl = s3Url;
    await authCode.save();

    res.json({
      success: true,
      message: 'QR code regenerated successfully',
      data: {
        codeId: authCode._id,
        code: authCode.code,
        qrCodeUrl: s3Url,
        qrData,
        brand: authCode.brand,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};