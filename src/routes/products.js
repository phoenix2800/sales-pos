const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { generateProductCode, calculatePagination } = require('../utils/helpers');
const { upload, imageUrlFor, thumbnailUrlFor, deleteImage, processUploadedFile, storageType } = require('../config/storage');

const router = express.Router();

// GET /api/products - List all products
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 50, category, search, active_only = 'true' } = req.query;
    const { offset, limit: lim } = calculatePagination(page, limit);

    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (active_only === 'true') {
      query += ' AND is_active = 1';
    }

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (name LIKE ? OR code LIKE ? OR description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    // For vendors (mobile POS), hide purchase price
    const isAdmin = req.user.role === 'admin';
    const selectFields = isAdmin
      ? '*'
      : 'id, name, code, selling_price, quantity, category, description, image_url, thumbnail_url, is_active';

    query = query.replace('SELECT *', `SELECT ${selectFields}`);

    const countQuery = query.replace(`SELECT ${selectFields}`, 'SELECT COUNT(*) as total');
    const totalRow = await getDb().get(countQuery, params);
    const total = totalRow.total;

    query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const products = await getDb().all(query, params);

    res.json({
      products,
      pagination: { page: parseInt(page), limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Error fetching products' });
  }
});

// GET /api/products/categories - List all categories
router.get('/categories/list', authMiddleware, async (req, res) => {
  try {
    const categories = await getDb().all('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category', []);
    res.json({ categories: categories.map(c => c.category) });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching categories' });
  }
});

// GET /api/products/search - Search products (public for POS speed)
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ products: [] });

    const isAdmin = req.user.role === 'admin';
    const selectFields = isAdmin
      ? '*'
      : 'id, name, code, selling_price, quantity, category, image_url, thumbnail_url';

    const products = await getDb().all(`SELECT ${selectFields} FROM products WHERE is_active = 1 AND (name LIKE ? OR code LIKE ?) LIMIT 20`, [`%${q}%`, `%${q}%`]);

    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: 'Error searching products' });
  }
});

// GET /api/products/category/:category - Products by category
router.get('/category/:category', authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const isAdmin = req.user.role === 'admin';
    const selectFields = isAdmin
      ? '*'
      : 'id, name, code, selling_price, quantity, category, image_url, thumbnail_url';

    const products = await getDb().all(`SELECT ${selectFields} FROM products WHERE is_active = 1 AND category = ? ORDER BY name`, [category]);

    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching products' });
  }
});

// GET /api/products/:id - Single product
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';
    const selectFields = isAdmin
      ? '*'
      : 'id, name, code, selling_price, quantity, category, description, image_url, thumbnail_url';

    const product = await getDb().get(`SELECT ${selectFields} FROM products WHERE id = ?`, [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ product });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching product' });
  }
});

// POST /api/products - Create product (Admin only)
router.post('/', authMiddleware, adminOnly, upload.single('image'), async (req, res) => {
  try {
    const { name, code, purchase_price = 0, selling_price = 0, quantity = 0, category, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const finalCode = code || generateProductCode();
    let image_url = null;
    let thumbnail_url = null;

    if (req.file) {
      await processUploadedFile(req.file);
      image_url = imageUrlFor(req.file);
      thumbnail_url = thumbnailUrlFor(image_url);
    }

    const result = await getDb().run(`INSERT INTO products (name, code, purchase_price, selling_price, quantity, category, description, image_url, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name, finalCode, purchase_price, selling_price, quantity, category || null, description || null, image_url, thumbnail_url]);

    // Record stock history
    if (parseInt(quantity) > 0) {
      await getDb().run('INSERT INTO stock_history (product_id, quantity_before, quantity_after, change_type, quantity_change, user_id) VALUES (?, ?, ?, ?, ?, ?)', [result.lastID, 0, parseInt(quantity), 'purchase', parseInt(quantity), req.user.id]);
    }

    const product = await getDb().get('SELECT * FROM products WHERE id = ?', [result.lastID]);

    // Notify connected clients via socket.io
    const io = req.app.get('io');
    if (io) io.emit('product:created', product);

    res.status(201).json({ product });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Error creating product: ' + error.message });
  }
});

// PUT /api/products/:id - Update product (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, purchase_price, selling_price, quantity, category, description, is_active } = req.body;

    const existing = await getDb().get('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const qtyBefore = existing.quantity;
    const qtyAfter = quantity !== undefined ? parseInt(quantity) : qtyBefore;

    await getDb().run(`UPDATE products SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        purchase_price = COALESCE(?, purchase_price),
        selling_price = COALESCE(?, selling_price),
        quantity = COALESCE(?, quantity),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [name || null,
      code || null,
      purchase_price !== undefined ? purchase_price : null,
      selling_price !== undefined ? selling_price : null,
      quantity !== undefined ? qtyAfter : null,
      category !== undefined ? category : null,
      description !== undefined ? description : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      id]);

    // Record stock change if quantity changed
    if (qtyAfter !== qtyBefore) {
      await getDb().run('INSERT INTO stock_history (product_id, quantity_before, quantity_after, change_type, quantity_change, user_id) VALUES (?, ?, ?, ?, ?, ?)', [id, qtyBefore, qtyAfter, 'adjustment', qtyAfter - qtyBefore, req.user.id]);
    }

    const product = await getDb().get('SELECT * FROM products WHERE id = ?', [id]);

    const io = req.app.get('io');
    if (io) io.emit('product:updated', product);

    res.json({ product });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Error updating product' });
  }
});

// PUT /api/products/:id/image - Update product image (Admin only)
router.put('/:id/image', authMiddleware, adminOnly, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const existing = await getDb().get('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    // Delete old image (handles both Cloudinary and local)
    if (existing.image_url) await deleteImage(existing.image_url);
    if (existing.thumbnail_url && existing.thumbnail_url !== thumbnailUrlFor(existing.image_url)) {
      await deleteImage(existing.thumbnail_url);
    }

    await processUploadedFile(req.file);
    const image_url = imageUrlFor(req.file);
    const thumbnail_url = thumbnailUrlFor(image_url);

    await getDb().run('UPDATE products SET image_url = ?, thumbnail_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [image_url, thumbnail_url, id]);

    const product = await getDb().get('SELECT * FROM products WHERE id = ?', [id]);

    const io = req.app.get('io');
    if (io) io.emit('product:updated', product);

    res.json({ product });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Error uploading image' });
  }
});

// DELETE /api/products/:id - Deactivate/delete product (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete - deactivate
    await getDb().run('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);

    const io = req.app.get('io');
    if (io) io.emit('product:deleted', { id });

    res.json({ message: 'Product deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deactivating product' });
  }
});

// GET /api/products/:id/stock-history - Product stock history
router.get('/:id/stock-history', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const history = await getDb().all(`
      SELECT sh.*, u.username as user_name, p.name as product_name
      FROM stock_history sh
      LEFT JOIN users u ON sh.user_id = u.id
      LEFT JOIN products p ON sh.product_id = p.id
      WHERE sh.product_id = ?
      ORDER BY sh.created_at DESC
      LIMIT 100
    `, [id]);

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stock history' });
  }
});

module.exports = router;
