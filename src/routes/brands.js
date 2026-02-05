const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');
const { protect } = require('../middleware/auth');

// All brand routes require authentication
router.use(protect);

router.post('/', brandController.createBrand);
router.get('/', brandController.getBrands);
router.get('/:id', brandController.getBrand);
router.patch('/:id', brandController.updateBrand);
router.delete('/:id', brandController.deleteBrand);

module.exports = router;
