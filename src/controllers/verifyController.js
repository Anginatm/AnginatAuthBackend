const AuthCode = require('../models/AuthCode');

/**
 * Verify a code - PUBLIC ENDPOINT
 * GET /api/verify/:code
 * 
 * Response:
 * - authenticated: true/false
 * - brand: { name, logo, ... } if authenticated
 */
exports.verify = async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({
        authenticated: false,
        message: 'Code is required',
      });
    }

    // Find the code and populate brand info
    const authCode = await AuthCode.findOne({ 
      code: code.trim(),
      status: 'active' 
    }).populate('brand', 'name logo description website contactEmail contactPhone status');

    // Code not found
    if (!authCode) {
      return res.json({
        authenticated: false,
        message: 'This code is not valid. Product may be counterfeit.',
      });
    }

    // Brand is inactive
    if (!authCode.brand || authCode.brand.status !== 'active') {
      return res.json({
        authenticated: false,
        message: 'This code is not valid. Product may be counterfeit.',
      });
    }

    // Update verification count
    await AuthCode.findByIdAndUpdate(authCode._id, {
      $inc: { verifyCount: 1 },
      $set: { firstVerifiedAt: authCode.firstVerifiedAt || new Date() },
    });

    // SUCCESS - Code is authentic
    res.json({
      authenticated: true,
      message: 'Product is genuine',
      brand: {
        name: authCode.brand.name,
        logo: authCode.brand.logo,
        description: authCode.brand.description,
        website: authCode.brand.website,
        contactEmail: authCode.brand.contactEmail,
        contactPhone: authCode.brand.contactPhone,
      },
    });
  } catch (error) {
    res.status(500).json({
      authenticated: false,
      message: 'Verification failed. Please try again.',
    });
  }
};

/**
 * Verify via POST (for apps that prefer POST)
 * POST /api/verify
 * Body: { code: "ABC123" }
 */
exports.verifyPost = async (req, res) => {
  req.params.code = req.body.code;
  return exports.verify(req, res);
};
