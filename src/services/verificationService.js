const { Product, Brand, ScanLog } = require('../models');

/**
 * Verification result statuses
 */
const VerificationStatus = {
  GENUINE: 'genuine',
  ALREADY_VERIFIED: 'already_verified',
  SUSPICIOUS: 'suspicious',
  NOT_FOUND: 'not_found',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

/**
 * Verify a product by auth token
 */
const verifyProduct = async (authToken, clientData = {}) => {
  const startTime = Date.now();
  
  // Find product by auth token
  const product = await Product.findOne({ authToken }).populate('brand', 'name logo settings status');
  
  // Product not found
  if (!product) {
    await logScan({
      authToken,
      result: VerificationStatus.NOT_FOUND,
      clientData,
      responseTimeMs: Date.now() - startTime,
    });
    
    return {
      status: VerificationStatus.NOT_FOUND,
      message: 'This product code was not found in our system. It may be counterfeit.',
      isAuthentic: false,
    };
  }
  
  // Brand is not active
  if (!product.brand || product.brand.status !== 'active') {
    return {
      status: VerificationStatus.NOT_FOUND,
      message: 'This product code is not currently verifiable.',
      isAuthentic: false,
    };
  }
  
  // Product is revoked
  if (product.status === 'revoked') {
    await logScan({
      authToken,
      product,
      result: VerificationStatus.REVOKED,
      clientData,
      responseTimeMs: Date.now() - startTime,
    });
    
    return {
      status: VerificationStatus.REVOKED,
      message: product.brand.settings?.notFoundMessage || 'This product code has been revoked and is no longer valid.',
      isAuthentic: false,
      brand: {
        name: product.brand.name,
        logo: product.brand.logo,
      },
    };
  }
  
  // Product is expired
  if (product.expiryDate && new Date(product.expiryDate) < new Date()) {
    await logScan({
      authToken,
      product,
      result: VerificationStatus.EXPIRED,
      clientData,
      responseTimeMs: Date.now() - startTime,
    });
    
    return {
      status: VerificationStatus.EXPIRED,
      message: 'This product has expired.',
      isAuthentic: true, // Product is authentic but expired
      brand: formatBrandInfo(product.brand),
      product: formatProductInfo(product),
    };
  }
  
  // Check for suspicious activity
  const suspiciousFlags = await ScanLog.checkSuspiciousActivity(authToken, clientData);
  
  // Determine if this is first scan
  const isFirstScan = product.scanCount === 0;
  
  // Record the scan
  await product.recordScan({
    location: clientData.location,
  });
  
  // Determine result
  let status;
  let message;
  let isAuthentic = true;
  
  if (suspiciousFlags.length > 0) {
    status = VerificationStatus.SUSPICIOUS;
    message = 'This product has been flagged for suspicious activity. Please verify through other means.';
    isAuthentic = false;
  } else if (isFirstScan) {
    status = VerificationStatus.GENUINE;
    message = product.brand.settings?.genuineMessage || 'This product is genuine and verified.';
  } else {
    status = VerificationStatus.ALREADY_VERIFIED;
    message = product.brand.settings?.alreadyVerifiedMessage || 
      'This product has been previously verified. Please ensure you purchased from an authorized seller.';
    
    // Check if scan count exceeds warning threshold
    if (product.brand.settings?.enableScanLimit && 
        product.scanCount > product.brand.settings?.maxScansBeforeWarning) {
      isAuthentic = false;
    }
  }
  
  // Log the scan
  await logScan({
    authToken,
    product,
    result: status,
    isFirstScan,
    scanNumber: product.scanCount,
    flags: suspiciousFlags,
    clientData,
    responseTimeMs: Date.now() - startTime,
  });
  
  // Update brand stats
  await Brand.findByIdAndUpdate(product.brand._id, {
    $inc: {
      'stats.totalScans': 1,
      'stats.genuineScans': status === VerificationStatus.GENUINE ? 1 : 0,
      'stats.suspiciousScans': status === VerificationStatus.SUSPICIOUS ? 1 : 0,
    },
  });
  
  return {
    status,
    message,
    isAuthentic,
    brand: formatBrandInfo(product.brand),
    product: formatProductInfo(product),
    scanInfo: {
      isFirstScan,
      totalScans: product.scanCount,
      firstScannedAt: product.firstScannedAt,
    },
    warnings: suspiciousFlags.length > 0 ? suspiciousFlags : undefined,
  };
};

/**
 * Log a scan attempt
 */
const logScan = async ({ authToken, product, result, isFirstScan, scanNumber, flags, clientData, responseTimeMs }) => {
  try {
    await ScanLog.create({
      product: product?._id,
      brand: product?.brand?._id || product?.brand,
      authToken,
      result,
      isFirstScan: isFirstScan || false,
      scanNumber: scanNumber || 1,
      ipAddress: clientData.ipAddress,
      userAgent: clientData.userAgent,
      location: clientData.location,
      device: clientData.device,
      flags: flags || [],
      referrer: clientData.referrer,
      responseTimeMs,
    });
  } catch (err) {
    console.error('Error logging scan:', err);
  }
};

/**
 * Format brand info for response
 */
const formatBrandInfo = (brand) => {
  if (!brand) return null;
  
  return {
    name: brand.name,
    logo: brand.logo,
    website: brand.website,
    contactEmail: brand.contactEmail,
  };
};

/**
 * Format product info for response
 */
const formatProductInfo = (product) => {
  if (!product) return null;
  
  return {
    name: product.name,
    sku: product.sku,
    batchNumber: product.batchNumber,
    serialNumber: product.serialNumber,
    category: product.category,
    manufacturingDate: product.manufacturingDate,
    expiryDate: product.expiryDate,
    metadata: product.metadata,
  };
};

/**
 * Get verification stats for a brand
 */
const getVerificationStats = async (brandId, startDate, endDate) => {
  return await ScanLog.getAnalytics(brandId, startDate, endDate);
};

module.exports = {
  VerificationStatus,
  verifyProduct,
  getVerificationStats,
};
