const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Use writable data directory; on hosting platforms (Render/Railway/Fly) use /tmp or persistent disk
const fs = require('fs');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch(e) { /* ignore */ }
}
const dbPath = path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency; fall back to DELETE on filesystems that don't support WAL
try { db.pragma('journal_mode = WAL'); } catch(e) { db.pragma('journal_mode = DELETE'); }
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendor', -- 'admin' or 'vendor'
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      purchase_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      description TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      location_gps TEXT,
      total_debt REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      client_id INTEGER NOT NULL,
      date DATE NOT NULL,
      time TIME NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      amount_debt REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid', -- 'paid', 'partial', 'unpaid'
      notes TEXT,
      user_id INTEGER,
      pdf_path TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL,
      profit_margin REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      invoice_id INTEGER,
      amount REAL NOT NULL,
      original_amount REAL NOT NULL,
      date DATE NOT NULL,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'unpaid', -- 'paid', 'unpaid', 'partial'
      paid_amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date DATE NOT NULL,
      notes TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      type TEXT NOT NULL, -- 'income' or 'expense'
      amount REAL NOT NULL,
      description TEXT,
      category TEXT,
      reference TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS stock_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity_before INTEGER NOT NULL,
      quantity_after INTEGER NOT NULL,
      change_type TEXT NOT NULL, -- 'sale', 'purchase', 'adjustment', 'return'
      quantity_change INTEGER NOT NULL,
      reference TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS printer_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_type TEXT NOT NULL DEFAULT 'network', -- 'usb', 'serial', 'network'
      address TEXT,
      port INTEGER DEFAULT 9100,
      vendor_id TEXT,
      product_id TEXT,
      paper_width INTEGER DEFAULT 80,
      auto_cut INTEGER DEFAULT 1,
      open_drawer INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_debts_client ON debts(client_id);
    CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
    CREATE INDEX IF NOT EXISTS idx_treasury_date ON treasury(date);
  `);

  // Seed default admin user
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
    ).run('admin', 'admin@example.com', hashedPassword, 'admin');
    console.log('✅ Default admin created: username=admin, password=admin123');
  }

  // Seed default vendor user
  const vendorExists = db.prepare('SELECT id FROM users WHERE username = ?').get('vendor');
  if (!vendorExists) {
    const hashedPassword = bcrypt.hashSync('vendor123', 10);
    db.prepare(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
    ).run('vendor', 'vendor@example.com', hashedPassword, 'vendor');
    console.log('✅ Default vendor created: username=vendor, password=vendor123');
  }

  // Seed default printer settings
  const printerExists = db.prepare('SELECT id FROM printer_settings WHERE is_active = 1').get();
  if (!printerExists) {
    db.prepare(
      'INSERT INTO printer_settings (connection_type, address, port) VALUES (?, ?, ?)'
    ).run('network', '192.168.1.100', 9100);
  }

  // Seed sample products
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (productCount.count === 0) {
    const sampleProducts = [
      { name: 'منتج تجريبي 1', code: 'P001', purchase_price: 50, selling_price: 100, quantity: 50, category: 'عام', description: 'وصف المنتج التجريبي الأول' },
      { name: 'Sample Product 2', code: 'P002', purchase_price: 30, selling_price: 75, quantity: 100, category: 'Electronics', description: 'Sample electronics product' },
      { name: 'Produit Test 3', code: 'P003', purchase_price: 20, selling_price: 50, quantity: 30, category: 'Food', description: 'Produit alimentaire test' },
    ];
    const insertProd = db.prepare(
      'INSERT INTO products (name, code, purchase_price, selling_price, quantity, category, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    sampleProducts.forEach(p => {
      insertProd.run(p.name, p.code, p.purchase_price, p.selling_price, p.quantity, p.category, p.description);
    });
    console.log('✅ Sample products created');
  }

  console.log('✅ Database initialized successfully');
}

module.exports = { db, initializeDatabase };
