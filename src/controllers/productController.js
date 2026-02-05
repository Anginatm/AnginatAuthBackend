const { Product, Brand } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/apiResponse');
const { processCSVUpload, generateCSVTemplate } = require('../services/csvService');
const { nanoid } = require('nanoid');
const config = require('../config');

/**
 * Create single product
 * POST /api/products
 */
const createProduct = catchAsync(async (req, res) => {
  // Generate authToken if not provided
  if (!req.body.authToken) {
    req.body.authToken = nanoid(32);
  }
  
  const product = await Product.create(req.body);
  
  // Update brand stats
  await Brand.findByIdAndUpdate(req.body.brand, {
    $inc: { 'stats.totalProducts': 1 },
  });
  
  return ApiResponse.created(res, 'Product created successfully', {
    ...product.toJSON(),
    verificationUrl: `${config.appUrl}/verify/${product.authToken}`,
  });
});

/**
 * Bulk create products
 * POST /api/products/bulk
 */
const bulkCreateProducts = catchAsync(async (req, res) => {
  const { brand, count, batchNumber, name, sku, category, manufacturingDate, expiryDate, metadata } = req.body;
  
  // Check brand exists
  const brandDoc = await Brand.findById(brand);
  if (!brandDoc) {
    return ApiResponse.notFound(res, 'Brand not found');
  }
  
  // Generate products
  const importBatch = `bulk_${Date.now()}_${nanoid(8)}`;
  const products = [];
  
  for (let i = 0; i < count; i++) {
    products.push({
      brand,
      authToken: nanoid(32),
      name,
      sku,
      batchNumber,
      category,
      manufacturingDate,
      expiryDate,
      metadata,
      importBatch,
    });
  }
  
  // Bulk insert
  const created = await Product.insertMany(products);
  
  // Update brand stats
  await Brand.findByIdAndUpdate(brand, {
    $inc: { 'stats.totalProducts': created.length },
  });
  
  return ApiResponse.created(res, `${created.length} products created successfully`, {
    importBatch,
    count: created.length,
    products: created.map((p) => ({
      id: p._id,
      authToken: p.authToken,
      verificationUrl: `${config.appUrl}/verify/${p.authToken}`,
    })),
  });
});

/**
 * Upload CSV to create products
 * POST /api/products/upload
 */
const uploadProducts = catchAsync(async (req, res) => {
  if (!req.file) {
    return ApiResponse.badRequest(res, 'Please upload a CSV file');
  }
  
  const { brand } = req.body;
  
  if (!brand) {
    return ApiResponse.badRequest(res, 'Brand ID is required');
  }
  
  // Check brand exists
  const brandDoc = await Brand.findById(brand);
  if (!brandDoc) {
    return ApiResponse.notFound(res, 'Brand not found');
  }
  
  // Process CSV
  const results = await processCSVUpload(req.file.path, brand);
  
  return ApiResponse.success(res, 'CSV processed successfully', {
    importBatch: results.importBatch,
    summary: {
      total: results.totalProcessed,
      success: results.success.length,
      failed: results.failed.length,
      duplicates: results.duplicates.length,
    },
    success: results.success.slice(0, 100), // Return first 100 for reference
    failed: results.failed,
    duplicates: results.duplicates,
  });
});

/**
 * Download CSV template
 * GET /api/products/template
 */
const downloadTemplate = catchAsync(async (req, res) => {
  const csv = generateCSVTemplate();
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.csv');
  res.send(csv);
});

/**
 * Get all products
 * GET /api/products
 */
const getProducts = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brand,
    status,
    batchNumber,
    search,
    importBatch,
    sort = '-createdAt',
  } = req.query;
  
  // Build query
  const query = {};
  
  if (brand) query.brand = brand;
  if (status) query.status = status;
  if (batchNumber) query.batchNumber = batchNumber;
  if (importBatch) query.importBatch = importBatch;
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { authToken: { $regex: search, $options: 'i' } },
      { serialNumber: { $regex: search, $options: 'i' } },
    ];
  }
  
  // For non-admin users, only show products from brands they have access to
  if (req.user.role !== 'admin') {
    query.brand = { $in: req.user.brandAccess };
  }
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const [products, total] = await Promise.all([
    Product.find(query)
      .populate('brand', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v'),
    Product.countDocuments(query),
  ]);
  
  // Add verification URLs
  const productsWithUrls = products.map((p) => ({
    ...p.toJSON(),
    verificationUrl: `${config.appUrl}/verify/${p.authToken}`,
  }));
  
  return ApiResponse.paginated(res, 'Products retrieved successfully', productsWithUrls, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
  });
});

/**
 * Get single product
 * GET /api/products/:id
 */
const getProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('brand', 'name slug logo')
    .populate('revokedBy', 'name email');
  
  if (!product) {
    return ApiResponse.notFound(res, 'Product not found');
  }
  
  return ApiResponse.success(res, 'Product retrieved successfully', {
    ...product.toJSON(),
    verificationUrl: `${config.appUrl}/verify/${product.authToken}`,
  });
});

/**
 * Get product by auth token
 * GET /api/products/token/:token
 */
const getProductByToken = catchAsync(async (req, res) => {
  const product = await Product.findOne({ authToken: req.params.token })
    .populate('brand', 'name slug logo');
  
  if (!product) {
    return ApiResponse.notFound(res, 'Product not found');
  }
  
  return ApiResponse.success(res, 'Product retrieved successfully', {
    ...product.toJSON(),
    verificationUrl: `${config.appUrl}/verify/${product.authToken}`,
  });
});

/**
 * Update product
 * PATCH /api/products/:id
 */
const updateProduct = catchAsync(async (req, res) => {
  const allowedUpdates = [
    'name',
    'sku',
    'batchNumber',
    'serialNumber',
    'category',
    'manufacturingDate',
    'expiryDate',
    'metadata',
  ];
  
  const updates = {};
  for (const key of Object.keys(req.body)) {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  }
  
  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  });
  
  if (!product) {
    return ApiResponse.notFound(res, 'Product not found');
  }
  
  return ApiResponse.success(res, 'Product updated successfully', product);
});

/**
 * Revoke product
 * POST /api/products/:id/revoke
 */
const revokeProduct = catchAsync(async (req, res) => {
  const { reason } = req.body;
  
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    return ApiResponse.notFound(res, 'Product not found');
  }
  
  if (product.status === 'revoked') {
    return ApiResponse.badRequest(res, 'Product is already revoked');
  }
  
  await product.revoke(reason, req.user._id);
  
  return ApiResponse.success(res, 'Product revoked successfully', product);
});

/**
 * Bulk revoke products
 * POST /api/products/bulk-revoke
 */
const bulkRevokeProducts = catchAsync(async (req, res) => {
  const { productIds, batchNumber, brand, reason } = req.body;
  
  if (!reason) {
    return ApiResponse.badRequest(res, 'Revocation reason is required');
  }
  
  let query = {};
  
  if (productIds && productIds.length > 0) {
    query._id = { $in: productIds };
  } else if (batchNumber && brand) {
    query = { batchNumber, brand };
  } else {
    return ApiResponse.badRequest(res, 'Provide either productIds or both batchNumber and brand');
  }
  
  const result = await Product.updateMany(
    { ...query, status: { $ne: 'revoked' } },
    {
      status: 'revoked',
      revokedAt: new Date(),
      revokedReason: reason,
      revokedBy: req.user._id,
    }
  );
  
  return ApiResponse.success(res, `${result.modifiedCount} products revoked successfully`, {
    modifiedCount: result.modifiedCount,
  });
});

/**
 * Delete product (admin only)
 * DELETE /api/products/:id
 */
const deleteProduct = catchAsync(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  
  if (!product) {
    return ApiResponse.notFound(res, 'Product not found');
  }
  
  // Update brand stats
  await Brand.findByIdAndUpdate(product.brand, {
    $inc: { 'stats.totalProducts': -1 },
  });
  
  return ApiResponse.success(res, 'Product deleted successfully');
});

/**
 * Get products by import batch
 * GET /api/products/batch/:importBatch
 */
const getProductsByBatch = catchAsync(async (req, res) => {
  const { importBatch } = req.params;
  const { page = 1, limit = 100 } = req.query;
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const [products, total] = await Promise.all([
    Product.find({ importBatch })
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .select('authToken name sku status createdAt'),
    Product.countDocuments({ importBatch }),
  ]);
  
  const productsWithUrls = products.map((p) => ({
    ...p.toJSON(),
    verificationUrl: `${config.appUrl}/verify/${p.authToken}`,
  }));
  
  return ApiResponse.paginated(res, 'Products retrieved successfully', productsWithUrls, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
  });
});

module.exports = {
  createProduct,
  bulkCreateProducts,
  uploadProducts,
  downloadTemplate,
  getProducts,
  getProduct,
  getProductByToken,
  updateProduct,
  revokeProduct,
  bulkRevokeProducts,
  deleteProduct,
  getProductsByBatch,
};
