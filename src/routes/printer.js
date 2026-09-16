const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/print/settings - Get current printer settings
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const settings = await getDb().get('SELECT * FROM printer_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1', []);
    res.json({ settings: settings || {} });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching printer settings' });
  }
});

// POST /api/print/initialize - Configure printer
router.post('/initialize', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { connection_type, address, port, vendor_id, product_id, paper_width = 80, auto_cut = 1, open_drawer = 0 } = req.body;

    // Deactivate all previous settings
    await getDb().run('UPDATE printer_settings SET is_active = 0', []);

    const result = await getDb().run(`INSERT INTO printer_settings (connection_type, address, port, vendor_id, product_id, paper_width, auto_cut, open_drawer, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [connection_type, address || null, port || 9100, vendor_id || null, product_id || null, paper_width, auto_cut ? 1 : 0, open_drawer ? 1 : 0]);

    const settings = await getDb().get('SELECT * FROM printer_settings WHERE id = ?', [result.lastID]);
    res.json({ message: 'Printer initialized', settings });
  } catch (error) {
    res.status(500).json({ error: 'Error initializing printer' });
  }
});

// POST /api/print/test - Test page
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const ESC = '\x1b';
    const testContent = [
      ESC + '@',
      ESC + 'a' + '\x01',
      ESC + 'E' + '\x01',
      'PRINTER TEST PAGE',
      'اختبار الطابعة',
      ESC + 'E' + '\x00',
      ESC + 'a' + '\x00',
      '----------------------------------------',
      'Printer: Thermal ESC/POS',
      'Paper: 80mm',
      'Date: ' + new Date().toISOString(),
      'Characters per line test:',
      '1234567890123456789012345678901234567890',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD',
      '----------------------------------------',
      'Arabic Test / اختبار اللغة العربية:',
      'مرحباً بكم في نظام إدارة المبيعات',
      '----------------------------------------',
      ESC + 'a' + '\x01',
      '*** PRINT SUCCESSFUL ***',
      '  تمت الطباعة بنجاح  ',
      ' ',
      ' ',
      ESC + 'm' // Partial cut
    ].join('\n');

    res.json({
      success: true,
      content: testContent,
      message: 'Test page sent to printer',
      note: 'In browser context, connect to printer via WebSocket/USB API and send this ESC/POS buffer'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generating test page' });
  }
});

// POST /api/print/cut-paper
router.post('/cut-paper', authMiddleware, async (req, res) => {
  const ESC = '\x1b';
  res.json({ content: '\n\n\n' + ESC + 'm', message: 'Cut command sent' });
});

// POST /api/print/open-drawer
router.post('/open-drawer', authMiddleware, async (req, res) => {
  const ESC = '\x1b';
  res.json({ content: ESC + 'p' + '\x00' + '\x0c' + '\x19', message: 'Drawer open command sent' });
});

// POST /api/print/status - Printer status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const settings = await getDb().get('SELECT * FROM printer_settings WHERE is_active = 1', []);
    // In a real deployment, you would ping the printer here
    res.json({
      connected: true,
      status: 'ready',
      settings,
      message: 'Printer is ready (simulated - in production, actual device check runs here)'
    });
  } catch (error) {
    res.json({ connected: false, status: 'offline' });
  }
});

module.exports = router;
