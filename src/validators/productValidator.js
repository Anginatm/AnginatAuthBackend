const { body, param, query } = require('express-validator');

const createProductValidator = [
  body('brand')
    .notEmpty()
    .withMessage('Brand ID is required')
    .isMongoId()
    .withMessage('Invalid brand ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Product name cannot exceed 500 characters'),
  
  body('sku')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('SKU cannot exceed 100 characters'),
  
  body('batchNumber')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Batch number cannot exceed 100 characters'),
  
  body('serialNumber')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Serial number cannot exceed 100 characters'),
  
  body('category')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Category cannot exceed 200 characters'),
  
  body('manufacturingDate')
    .optional()
    .isISO8601()
    .withMessage('Manufacturing date must be a valid date'),
  
  body('expiryDate')
    .optional()
    .isISO8601()
    .withMessage('Expiry date must be a valid date'),
  
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
];

const updateProductValidator = [
  param('id')
    .isMongoId()
    .withMessage('Invalid product ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Product name cannot exceed 500 characters'),
  
  body('sku')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('SKU cannot exceed 100 characters'),
  
  body('status')
    .optional()
    .isIn(['active', 'verified', 'suspicious', 'revoked', 'expired'])
    .withMessage('Invalid status'),
];

const productIdValidator = [
  param('id')
    .isMongoId()
    .withMessage('Invalid product ID'),
];

const listProductsValidator = [
  query('brand')
    .optional()
    .isMongoId()
    .withMessage('Invalid brand ID'),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('status')
    .optional()
    .isIn(['active', 'verified', 'suspicious', 'revoked', 'expired'])
    .withMessage('Invalid status filter'),
  
  query('search')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters'),
  
  query('batchNumber')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Batch number filter too long'),
];

const bulkCreateValidator = [
  body('brand')
    .notEmpty()
    .withMessage('Brand ID is required')
    .isMongoId()
    .withMessage('Invalid brand ID'),
  
  body('count')
    .notEmpty()
    .withMessage('Count is required')
    .isInt({ min: 1, max: 10000 })
    .withMessage('Count must be between 1 and 10000'),
  
  body('batchNumber')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Batch number cannot exceed 100 characters'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Product name cannot exceed 500 characters'),
];

const verifyTokenValidator = [
  param('token')
    .notEmpty()
    .withMessage('Token is required')
    .isLength({ min: 20, max: 64 })
    .withMessage('Invalid token format'),
];

const revokeProductValidator = [
  param('id')
    .isMongoId()
    .withMessage('Invalid product ID'),
  
  body('reason')
    .notEmpty()
    .withMessage('Revocation reason is required')
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters'),
];

module.exports = {
  createProductValidator,
  updateProductValidator,
  productIdValidator,
  listProductsValidator,
  bulkCreateValidator,
  verifyTokenValidator,
  revokeProductValidator,
};
