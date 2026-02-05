const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const productController = require('../controllers/productController');
const { protect, restrictTo, checkBrandAccess } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const config = require('../config');
const {
  createProductValidator,
  updateProductValidator,
  productIdValidator,
  listProductsValidator,
  bulkCreateValidator,
  revokeProductValidator,
} = require('../validators/productValidator');

// Configure multer for CSV uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `products-${uniqueSuffix}.csv`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'text/csv' || 
      file.originalname.endsWith('.csv') ||
      file.mimetype === 'application/vnd.ms-excel') {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
  },
});

// All routes require authentication
router.use(protect);

// CSV template download
router.get('/template', productController.downloadTemplate);

// List products
router.get('/', listProductsValidator, validate, productController.getProducts);

// Bulk operations
router.post('/bulk', restrictTo('admin', 'brand_manager'), bulkCreateValidator, validate, productController.bulkCreateProducts);
router.post('/upload', restrictTo('admin', 'brand_manager'), uploadLimiter, upload.single('file'), productController.uploadProducts);
router.post('/bulk-revoke', restrictTo('admin', 'brand_manager'), productController.bulkRevokeProducts);

// Get products by import batch
router.get('/batch/:importBatch', productController.getProductsByBatch);

// Get product by auth token
router.get('/token/:token', productController.getProductByToken);

// Create single product
router.post('/', restrictTo('admin', 'brand_manager'), createProductValidator, validate, productController.createProduct);

// Single product operations
router.get('/:id', productIdValidator, validate, productController.getProduct);
router.patch('/:id', restrictTo('admin', 'brand_manager'), updateProductValidator, validate, productController.updateProduct);
router.delete('/:id', restrictTo('admin'), productIdValidator, validate, productController.deleteProduct);

// Revoke product
router.post('/:id/revoke', restrictTo('admin', 'brand_manager'), revokeProductValidator, validate, productController.revokeProduct);

module.exports = router;
