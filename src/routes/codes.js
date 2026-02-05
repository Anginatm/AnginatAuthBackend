const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const codeController = require('../controllers/codeController');
const { protect } = require('../middleware/auth');

// Configure multer for file uploads (CSV and Excel)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `codes-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'), false);
    }
  },
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// All code routes require authentication
router.use(protect);

// ============================================
// QR CODE ROUTES
// ============================================

// Generate QR code for a code
router.post('/:id/generate-qr', codeController.generateQRCode);

// Get QR code for a code
router.get('/:id/qr', codeController.getQRCode);

// Regenerate QR code for a code
router.patch('/:id/regenerate-qr', codeController.regenerateQRCode);

// ============================================
// BULK UPLOAD ROUTES (NEW)
// ============================================

// Bulk upload with background processing (CSV or Excel)
router.post('/bulk-upload', upload.single('file'), codeController.bulkUpload);

// Get bulk upload job status
router.get('/bulk-upload/:jobId', codeController.getBulkUploadStatus);

// Get all bulk upload jobs for authenticated user
router.get('/bulk-upload-jobs', codeController.getBulkUploadJobs);

// Cancel bulk upload job
router.patch('/bulk-upload/:jobId/cancel', codeController.cancelBulkUpload);

// ============================================
// TEMPLATE DOWNLOADS
// ============================================

// Download CSV template
router.get('/template/csv', codeController.downloadTemplate);

// Download Excel template
router.get('/template/excel', codeController.downloadExcelTemplate);

// ============================================
// LEGACY & SINGLE CODE ROUTES
// ============================================

// Legacy CSV upload (synchronous - for small files)
router.post('/upload', upload.single('file'), codeController.uploadCodes);

// Add single code
router.post('/', codeController.addCode);

// Get codes with filtering and pagination
router.get('/', codeController.getCodes);

// Delete code
router.delete('/:id', codeController.deleteCode);

// Deactivate code
router.patch('/:id/deactivate', codeController.deactivateCode);

module.exports = router;