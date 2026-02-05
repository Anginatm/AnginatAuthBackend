const { parse } = require('csv-parse');
const fs = require('fs');
const { Product } = require('../models');
const { nanoid } = require('nanoid');

/**
 * Parse CSV file and return array of product data
 */
const parseCSV = (filePath, options = {}) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowNumber = 0;
    
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      skip_records_with_error: true,
      ...options,
    });
    
    parser.on('readable', function () {
      let record;
      while ((record = parser.read()) !== null) {
        rowNumber++;
        results.push({ row: rowNumber, data: record });
      }
    });
    
    parser.on('error', function (err) {
      errors.push({ row: rowNumber, error: err.message });
    });
    
    parser.on('end', function () {
      resolve({ results, errors, totalRows: rowNumber });
    });
    
    fs.createReadStream(filePath).pipe(parser);
  });
};

/**
 * Map CSV columns to product fields
 * Supports flexible column naming
 */
const mapCSVToProduct = (row, brandId, importBatch) => {
  // Column name mappings (case-insensitive)
  const columnMappings = {
    // Auth token
    authToken: ['authtoken', 'auth_token', 'token', 'code', 'authentication_code', 'auth_code'],
    // Product name
    name: ['name', 'product_name', 'productname', 'product', 'title'],
    // SKU
    sku: ['sku', 'product_sku', 'item_code', 'itemcode'],
    // Batch number
    batchNumber: ['batchnumber', 'batch_number', 'batch', 'batch_no', 'batchno', 'lot', 'lot_number'],
    // Serial number
    serialNumber: ['serialnumber', 'serial_number', 'serial', 'serial_no'],
    // Category
    category: ['category', 'product_category', 'type', 'product_type'],
    // Manufacturing date
    manufacturingDate: ['manufacturingdate', 'manufacturing_date', 'mfg_date', 'mfgdate', 'manufactured', 'production_date'],
    // Expiry date
    expiryDate: ['expirydate', 'expiry_date', 'exp_date', 'expdate', 'expiry', 'best_before', 'bestbefore'],
  };
  
  const getValue = (mappings) => {
    for (const mapping of mappings) {
      const key = Object.keys(row).find((k) => k.toLowerCase().replace(/\s+/g, '_') === mapping);
      if (key && row[key]) {
        return row[key].trim();
      }
    }
    return undefined;
  };
  
  // Extract values
  const authToken = getValue(columnMappings.authToken);
  const name = getValue(columnMappings.name);
  const sku = getValue(columnMappings.sku);
  const batchNumber = getValue(columnMappings.batchNumber);
  const serialNumber = getValue(columnMappings.serialNumber);
  const category = getValue(columnMappings.category);
  const manufacturingDate = getValue(columnMappings.manufacturingDate);
  const expiryDate = getValue(columnMappings.expiryDate);
  
  // Collect extra fields as metadata
  const knownFields = new Set(
    Object.values(columnMappings).flat()
  );
  const metadata = {};
  
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
    if (!knownFields.has(normalizedKey) && value) {
      metadata[key] = value;
    }
  }
  
  return {
    brand: brandId,
    authToken: authToken || nanoid(32), // Generate if not provided
    name,
    sku,
    batchNumber,
    serialNumber,
    category,
    manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : undefined,
    expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    importBatch,
  };
};

/**
 * Process CSV file and create products
 */
const processCSVUpload = async (filePath, brandId, options = {}) => {
  const importBatch = `import_${Date.now()}_${nanoid(8)}`;
  const results = {
    importBatch,
    success: [],
    failed: [],
    duplicates: [],
    totalProcessed: 0,
  };
  
  try {
    // Parse CSV
    const { results: csvRows, errors: parseErrors } = await parseCSV(filePath);
    
    if (parseErrors.length > 0) {
      results.failed.push(...parseErrors.map((e) => ({
        row: e.row,
        error: `Parse error: ${e.error}`,
      })));
    }
    
    // Process each row
    const productsToCreate = [];
    const authTokensInBatch = new Set();
    
    for (const { row, data } of csvRows) {
      try {
        const productData = mapCSVToProduct(data, brandId, importBatch);
        
        // Check for duplicate auth token in batch
        if (authTokensInBatch.has(productData.authToken)) {
          results.duplicates.push({
            row,
            authToken: productData.authToken,
            error: 'Duplicate auth token in CSV',
          });
          continue;
        }
        
        authTokensInBatch.add(productData.authToken);
        productsToCreate.push({ row, data: productData });
      } catch (err) {
        results.failed.push({
          row,
          error: err.message,
        });
      }
    }
    
    // Check for existing auth tokens in database
    const existingTokens = await Product.find({
      authToken: { $in: [...authTokensInBatch] },
    }).select('authToken');
    
    const existingTokenSet = new Set(existingTokens.map((p) => p.authToken));
    
    // Filter out existing tokens
    const newProducts = productsToCreate.filter(({ row, data }) => {
      if (existingTokenSet.has(data.authToken)) {
        results.duplicates.push({
          row,
          authToken: data.authToken,
          error: 'Auth token already exists in database',
        });
        return false;
      }
      return true;
    });
    
    // Bulk insert new products
    if (newProducts.length > 0) {
      const insertData = newProducts.map((p) => p.data);
      
      try {
        const inserted = await Product.insertMany(insertData, { ordered: false });
        results.success = inserted.map((p) => ({
          id: p._id,
          authToken: p.authToken,
        }));
      } catch (bulkError) {
        // Handle partial success in bulk insert
        if (bulkError.insertedDocs) {
          results.success = bulkError.insertedDocs.map((p) => ({
            id: p._id,
            authToken: p.authToken,
          }));
        }
        
        if (bulkError.writeErrors) {
          for (const writeError of bulkError.writeErrors) {
            results.failed.push({
              row: newProducts[writeError.index]?.row,
              error: writeError.errmsg,
            });
          }
        }
      }
    }
    
    results.totalProcessed = csvRows.length;
    
    // Update brand stats
    if (results.success.length > 0) {
      const { Brand } = require('../models');
      await Brand.findByIdAndUpdate(brandId, {
        $inc: { 'stats.totalProducts': results.success.length },
      });
    }
    
    return results;
  } finally {
    // Clean up uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Error deleting temp file:', err);
    }
  }
};

/**
 * Generate sample CSV template
 */
const generateCSVTemplate = () => {
  const headers = [
    'auth_token',
    'name',
    'sku',
    'batch_number',
    'serial_number',
    'category',
    'manufacturing_date',
    'expiry_date',
  ];
  
  const sampleRows = [
    ['ABC123XYZ456', 'Product Name 1', 'SKU-001', 'BATCH-2024-001', 'SN-00001', 'Electronics', '2024-01-15', '2026-01-15'],
    ['DEF789GHI012', 'Product Name 2', 'SKU-002', 'BATCH-2024-001', 'SN-00002', 'Electronics', '2024-01-15', '2026-01-15'],
    ['', 'Product Name 3', 'SKU-003', 'BATCH-2024-002', '', 'Cosmetics', '2024-02-01', '2025-02-01'],
  ];
  
  let csv = headers.join(',') + '\n';
  for (const row of sampleRows) {
    csv += row.join(',') + '\n';
  }
  
  return csv;
};

module.exports = {
  parseCSV,
  mapCSVToProduct,
  processCSVUpload,
  generateCSVTemplate,
};
