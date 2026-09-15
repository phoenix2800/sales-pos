const express = require('express');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { calculatePagination } = require('../utils/helpers');

const router = express.Router();

// GET /api/clients - List all clients
router.get('/', authMiddleware, (req, res) => {
  try {
    const { page = 1, limit = 50, search, with_debt = 'false' } = req.query;
    const { offset, limit: lim } = calculatePagination(page, limit);

    let query = 'SELECT * FROM clients WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (with_debt === 'true') {
      query += ' AND total_debt > 0';
    }

    const countResult = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as total')).get(...params);
    const total = countResult.total;

    query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const clients = db.prepare(query).all(...params);

    res.json({
      clients,
      pagination: { page: parseInt(page), limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Error fetching clients' });
  }
});

// GET /api/clients/:id - Single client with details
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const locations = db.prepare('SELECT * FROM client_locations WHERE client_id = ?').all(id);
    const invoices = db.prepare(
      'SELECT id, invoice_number, date, total_amount, amount_paid, amount_debt, status FROM invoices WHERE client_id = ? ORDER BY date DESC LIMIT 50'
    ).all(id);
    const debts = db.prepare(
      'SELECT * FROM debts WHERE client_id = ? ORDER BY date DESC'
    ).all(id);

    res.json({ client, locations, invoices, debts });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching client' });
  }
});

// GET /api/clients/:id/purchase-history
router.get('/:id/purchase-history', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const invoices = db.prepare(`
      SELECT i.*, COUNT(id.id) as items_count
      FROM invoices i
      LEFT JOIN invoice_details id ON i.id = id.invoice_id
      WHERE i.client_id = ? AND i.is_archived = 0
      GROUP BY i.id
      ORDER BY i.date DESC, i.time DESC
    `).all(id);

    res.json({ invoices });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching purchase history' });
  }
});

// POST /api/clients - Create new client
router.post('/', authMiddleware, (req, res) => {
  try {
    const { name, phone, email, address, location_gps, locations = [] } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const result = db.prepare(
      'INSERT INTO clients (name, phone, email, address, location_gps) VALUES (?, ?, ?, ?, ?)'
    ).run(name, phone || null, email || null, address || null, location_gps || null);

    const clientId = result.lastInsertRowid;

    // Add multiple locations
    if (Array.isArray(locations) && locations.length > 0) {
      const insertLoc = db.prepare(
        'INSERT INTO client_locations (client_id, name, latitude, longitude, address) VALUES (?, ?, ?, ?, ?)'
      );
      locations.forEach(loc => {
        insertLoc.run(clientId, loc.name || null, loc.latitude || null, loc.longitude || null, loc.address || null);
      });
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);

    const io = req.app.get('io');
    if (io) io.emit('client:created', client);

    res.status(201).json({ client });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Error creating client' });
  }
});

// PUT /api/clients/:id - Update client
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address, location_gps } = req.body;

    db.prepare(
      `UPDATE clients SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        location_gps = COALESCE(?, location_gps),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(name || null, phone || null, email || null, address || null, location_gps || null, id);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) io.emit('client:updated', client);

    res.json({ client });
  } catch (error) {
    res.status(500).json({ error: 'Error updating client' });
  }
});

// POST /api/clients/:id/locations - Add location to client
router.post('/:id/locations', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, latitude, longitude, address } = req.body;

    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const result = db.prepare(
      'INSERT INTO client_locations (client_id, name, latitude, longitude, address) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name || null, latitude || null, longitude || null, address || null);

    const location = db.prepare('SELECT * FROM client_locations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ location });
  } catch (error) {
    res.status(500).json({ error: 'Error adding location' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    res.json({ message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting client' });
  }
});

module.exports = router;
