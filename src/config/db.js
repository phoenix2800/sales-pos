/**
 * Unified async database layer
 * - SQLite (default, local dev / ephemeral hosting)
 * - PostgreSQL (DATABASE_TYPE=postgres + DATABASE_URL) — Supabase / Neon / Render PG
 *
 * Exposes async helpers: db.run(), db.get(), db.all(), db.exec()
 * They work identically in both modes, so route code doesn't care which DB is in use.
 */
const fs = require('fs');
const path = require('path');

const DB_TYPE = (process.env.DATABASE_TYPE || 'sqlite').toLowerCase();

// ---------- Schema (SQLite syntax; auto-converted for PostgreSQL) ----------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'vendor',
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    status TEXT NOT NULL DEFAULT 'unpaid',
    notes TEXT,
    user_id INTEGER,
    pdf_path TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoice_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    purchase_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL,
    profit_margin REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    invoice_id INTEGER,
    amount REAL NOT NULL,
    original_amount REAL NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'unpaid',
    paid_amount REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS debt_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date DATE NOT NULL,
    notes TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS treasury (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    category TEXT,
    reference TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stock_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    change_type TEXT NOT NULL,
    quantity_change INTEGER NOT NULL,
    reference TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS printer_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_type TEXT NOT NULL DEFAULT 'network',
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
`;

// ---------- SQLite adapter ----------
function initSQLite() {
  const Database = require('better-sqlite3');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) { try { fs.mkdirSync(dataDir, { recursive: true }); } catch(e) {} }
  const dbPath = path.join(dataDir, 'database.sqlite');
  const sqliteDb = new Database(dbPath);
  try { sqliteDb.pragma('journal_mode = WAL'); } catch(e) { sqliteDb.pragma('journal_mode = DELETE'); }
  sqliteDb.pragma('foreign_keys = ON');

  return {
    raw: sqliteDb,
    type: 'sqlite',
    async run(sql, params = []) {
      const stmt = sqliteDb.prepare(sql);
      const info = stmt.run(...params);
      return { lastID: info.lastInsertRowid, changes: info.changes };
    },
    async get(sql, params = []) {
      return sqliteDb.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return sqliteDb.prepare(sql).all(...params);
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    }
  };
}

// ---------- PostgreSQL adapter ----------
function sqliteToPg(sql) {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
    .replace(/AUTOINCREMENT/g, '')
    .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
}

function convertParams(sql, params) {
  // SQLite uses ?, PostgreSQL uses $1, $2...
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  return { sql: pgSql, params };
}

async function initPostgres() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  // Test
  const c = await pool.connect();
  await c.query('SELECT 1');
  c.release();
  console.log(`✅ Connected to PostgreSQL`);

  return {
    raw: pool,
    type: 'postgres',
    pool,
    async run(sql, params = []) {
      const { sql: pgSql, params: p } = convertParams(sql, params);
      // Auto-add RETURNING id for INSERT statements that don't have it
      let finalSql = pgSql;
      if (/^\s*INSERT\s+INTO/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
        finalSql = pgSql + ' RETURNING id';
      }
      const res = await pool.query(finalSql, p);
      return {
        lastID: res.rows[0]?.id || null,
        changes: res.rowCount
      };
    },
    async get(sql, params = []) {
      const { sql: pgSql, params: p } = convertParams(sql + ' LIMIT 1', params);
      const res = await pool.query(pgSql, p);
      return res.rows[0] || null;
    },
    async all(sql, params = []) {
      const { sql: pgSql, params: p } = convertParams(sql, params);
      const res = await pool.query(pgSql, p);
      return res.rows;
    },
    async exec(sql) {
      const pgSql = sqliteToPg(sql);
      // Split on semicolons, ignoring those inside strings (simple split works for our schema)
      const stmts = pgSql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const s of stmts) {
        try { await pool.query(s); } catch (e) {
          // Ignore "already exists" errors for IF NOT EXISTS tables
          if (!/already exists/i.test(e.message)) throw e;
        }
      }
    }
  };
}

// ---------- Init ----------
let dbInstance = null;

async function initDatabase() {
  if (dbInstance) return dbInstance;

  dbInstance = DB_TYPE === 'postgres' ? await initPostgres() : initSQLite();
  await dbInstance.exec(DB_TYPE === 'postgres' ? sqliteToPg(SCHEMA) : SCHEMA);

  // Seed admin
  const bcrypt = require('bcryptjs');
  const { count: userCount } = await dbInstance.get('SELECT COUNT(*) as count FROM users');
  if (!userCount || Number(userCount) === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);
    const res = await dbInstance.run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [adminUsername, 'admin@local', hashedPassword, 'admin']
    );
    console.log(`✅ Admin account created: ${adminUsername}`);
  }

  // Seed default printer settings
  const printer = await dbInstance.get('SELECT id FROM printer_settings WHERE is_active = 1');
  if (!printer) {
    await dbInstance.run(
      'INSERT INTO printer_settings (connection_type, address, port) VALUES (?, ?, ?)',
      ['network', '', 9100]
    );
  }

  console.log(`✅ Database ready (${DB_TYPE.toUpperCase()})`);
  return dbInstance;
}

// Synchronous getter for use after initDatabase() has run.
// Routes are expected to call await db.run() / await db.get() / await db.all()
function getDb() {
  if (!dbInstance) throw new Error('Database not initialized. Call initDatabase() first.');
  return dbInstance;
}

module.exports = { initDatabase, getDb, DB_TYPE };
