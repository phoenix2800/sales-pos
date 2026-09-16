const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDb, DB_TYPE } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { storageType } = require('../config/storage');
router.use(authMiddleware);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'database.sqlite');
const uploadsDir = path.join(__dirname, '../../uploads');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// Download full backup (DB + images + PDFs) as ZIP
router.get('/download', requireAdmin, async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0,10);
    const archiver = require('archiver');
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="sales-full-backup-${date}.zip"`);
    archive.pipe(res);

    if (DB_TYPE === 'postgres') {
      const db = getDb();
      const tables = ['users','products','clients','client_locations','invoices','invoice_details','debts','debt_payments','treasury','stock_history','printer_settings'];
      const dump = {};
      for (const t of tables) {
        try { dump[t] = await db.all(`SELECT * FROM ${t}`, []); } catch(e) { dump[t] = []; }
      }
      archive.append(JSON.stringify(dump, null, 2), { name: 'database.json' });
    } else if (fs.existsSync(dbPath)) {
      archive.file(dbPath, { name: 'database.sqlite' });
    }

    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'uploads');
    }

    archive.append(JSON.stringify({
      backupDate: new Date().toISOString(),
      dbType: DB_TYPE,
      appVersion: '1.1-full-backup'
    }, null, 2), { name: 'backup-meta.json' });

    await archive.finalize();
  } catch(e) {
    console.error('Backup error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// Restore full backup from ZIP (uploads + SQLite)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200*1024*1024 } });

router.post('/restore', requireAdmin, upload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (DB_TYPE === 'postgres') {
    return res.status(400).json({ error: 'On PostgreSQL use Neon/Supabase dashboard for DB. Re-upload product images or set up Cloudinary for permanent image storage.' });
  }

  try {
    const AdmZip = require('adm-zip');
    let zip;
    try { zip = new AdmZip(req.file.buffer); } catch(e) { return res.status(400).json({ error: 'Invalid ZIP file' }); }

    const entries = zip.getEntries();
    const dbEntry = entries.find(e => e.entryName === 'database.sqlite');
    if (!dbEntry) return res.status(400).json({ error: 'No database.sqlite in backup (this is not a valid full backup)' });

    const dbBuf = dbEntry.getData();
    const tmpDb = dbPath + '.tmp';
    fs.writeFileSync(tmpDb, dbBuf);
    const Database = require('better-sqlite3');
    try {
      const test = new Database(tmpDb, { readonly: true });
      test.prepare('SELECT COUNT(*) FROM users').get();
      test.close();
    } catch(e) {
      fs.unlinkSync(tmpDb);
      return res.status(400).json({ error: 'Invalid DB in backup: ' + e.message });
    }

    fs.copyFileSync(tmpDb, dbPath);
    fs.unlinkSync(tmpDb);

    // Restore uploads folder
    let restoredFiles = 0;
    for (const entry of entries) {
      if (entry.entryName.startsWith('uploads/') && !entry.isDirectory) {
        const targetPath = path.join(__dirname, '../../', entry.entryName);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, entry.getData());
        restoredFiles++;
      }
    }

    res.json({
      success: true,
      message: `✅ Backup restored (DB + ${restoredFiles} images/PDFs). Server restarting...`
    });
    setTimeout(() => process.exit(0), 2000);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// JSON export of all data (works for both SQLite + Postgres)
router.get('/export-json', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const tables = ['users','products','clients','client_locations','invoices','invoice_details','debts','debt_payments','treasury','stock_history','printer_settings'];
    const dump = {};
    for (const t of tables) {
      try { dump[t] = await db.all(`SELECT * FROM ${t}`, []); } catch(e) { dump[t] = []; }
    }
    // Never export password hashes
    if (dump.users) dump.users = dump.users.map(u => { const { password, ...rest } = u; return rest; });
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="sales-data-${date}.json"`);
    res.send(JSON.stringify({
      exportedAt: new Date().toISOString(),
      dbType: DB_TYPE,
      storageType,
      version: '1.1',
      data: dump
    }, null, 2));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// JSON import (restore data) — appends to existing DB with conflict handling
router.post('/import-json', requireAdmin, upload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const payload = JSON.parse(req.file.buffer.toString('utf8'));
    const dump = payload.data || payload;
    const db = getDb();

    let imported = { clients: 0, products: 0, invoices: 0 };

    // Import clients (by phone match to avoid duplicates)
    if (Array.isArray(dump.clients)) {
      for (const c of dump.clients) {
        const existing = c.phone ? await db.get('SELECT id FROM clients WHERE phone = ?', [c.phone]) : null;
        if (!existing) {
          await db.run('INSERT INTO clients (name, phone, email, address, location_gps, total_debt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [c.name, c.phone || null, c.email || null, c.address || null, c.location_gps || null, c.total_debt || 0, c.created_at || new Date().toISOString()]);
          imported.clients++;
        }
      }
    }

    // Import products (by code match to avoid duplicates)
    if (Array.isArray(dump.products)) {
      for (const p of dump.products) {
        const existing = p.code ? await db.get('SELECT id FROM products WHERE code = ?', [p.code]) : null;
        if (!existing) {
          await db.run('INSERT INTO products (name, code, purchase_price, selling_price, quantity, category, description, image_url, thumbnail_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [p.name, p.code || null, p.purchase_price || 0, p.selling_price || 0, p.quantity || 0, p.category || null, p.description || null, p.image_url || null, p.thumbnail_url || null, p.is_active !== undefined ? p.is_active : 1, p.created_at || new Date().toISOString()]);
          imported.products++;
        } else {
          // Update stock
          await db.run('UPDATE products SET quantity = ? WHERE id = ?', [Math.max((existing.quantity||0), p.quantity || 0), existing.id]);
        }
      }
    }

    res.json({
      success: true,
      message: `✅ Imported ${imported.clients} clients, ${imported.products} products. Invoices/debts require full backup.`,
      imported
    });
  } catch(err) {
    console.error('JSON import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const [products, clients, invoices, debts, users] = await Promise.all([
      db.get('SELECT COUNT(*) as c FROM products', []),
      db.get('SELECT COUNT(*) as c FROM clients', []),
      db.get('SELECT COUNT(*) as c FROM invoices', []),
      db.get('SELECT COUNT(*) as c FROM debts WHERE status != ?', ['paid']),
      db.get('SELECT COUNT(*) as c FROM users', []),
    ]);
    let dbSize = 0, lastModified = null, imagesCount = 0;
    const walkDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walkDir(full);
        else if (/\.(jpg|jpeg|png|webp|pdf)$/i.test(f.name)) imagesCount++;
      }
    };
    walkDir(uploadsDir);
    if (DB_TYPE === 'sqlite' && fs.existsSync(dbPath)) {
      const s = fs.statSync(dbPath);
      dbSize = s.size;
      lastModified = s.mtime;
    }
    res.json({
      products: products.c, clients: clients.c, invoices: invoices.c,
      debts: debts.c, users: users.c, imagesCount,
      dbSize, lastModified, dbType: DB_TYPE, storageType
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
