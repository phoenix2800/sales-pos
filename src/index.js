const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');

const { initializeDatabase } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const clientRoutes = require('./routes/clients');
const invoiceRoutes = require('./routes/invoices');
const debtRoutes = require('./routes/debts');
const treasuryRoutes = require('./routes/treasury');
const analyticsRoutes = require('./routes/analytics');
const printerRoutes = require('./routes/printer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configurable directories (for cloud hosting)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
[UPLOAD_DIR, DATA_DIR, path.join(UPLOAD_DIR, 'products'), path.join(UPLOAD_DIR, 'pdfs')].forEach(dir => {
  const fs = require('fs');
  if (!fs.existsSync(dir)) { try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {} }
});

// Static files
app.use('/uploads', express.static(UPLOAD_DIR));

// Make io available to routes
app.set('io', io);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.emit('connected', { message: 'Connected to real-time updates' });
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/cashier', treasuryRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/print', printerRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    name: 'Sales & Inventory Management API',
    version: '1.0.0'
  });
});

// Serve admin dashboard static files (production)
const adminDist = path.join(__dirname, '../public/admin');
const posDist = path.join(__dirname, '../public/pos');
const fs = require('fs');

// Serve static assets with redirect off to avoid trailing-slash loops
app.use('/admin/assets', express.static(path.join(adminDist, 'assets')));
app.use('/pos/assets', express.static(path.join(posDist, 'assets')));

// Explicitly serve index.html for /admin and /admin/ and any SPA route
function serveSPA(distPath) {
  return (req, res) => {
    const indexFile = path.join(distPath, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(404).send('App not built. Run npm run build first.');
    }
  };
}

app.get('/admin', serveSPA(adminDist));
app.get('/admin/', serveSPA(adminDist));
app.get('/admin/*', serveSPA(adminDist));
app.get('/pos', serveSPA(posDist));
app.get('/pos/', serveSPA(posDist));
app.get('/pos/*', serveSPA(posDist));

// Root redirect - QR code access page
app.get('/', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  const baseUrl = `${protocol}://${host}`;

  // Dynamically generate a QR code page
  const QRCode = require('qrcode');
  QRCode.toDataURL(`${baseUrl}/pos/`, { margin: 2, width: 280, color: { dark: '#4f46e5', light: '#ffffff' } }, (err, posQr) => {
    QRCode.toDataURL(`${baseUrl}/admin/`, { margin: 2, width: 200, color: { dark: '#4f46e5', light: '#ffffff' } }, (err2, adminQr) => {
      res.send(`
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sales & Inventory - Access</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
        body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 30px 20px; color: white; }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { text-align: center; font-size: 2rem; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .subtitle { text-align: center; opacity: 0.9; margin-bottom: 40px; font-size: 1rem; }
        .qr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
        .qr-card { background: white; color: #1f2937; border-radius: 20px; padding: 30px 24px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
        .qr-card.pos { border-top: 6px solid #10b981; }
        .qr-card.admin { border-top: 6px solid #6366f1; }
        .qr-icon { font-size: 2.5rem; margin-bottom: 8px; }
        .qr-card h2 { font-size: 1.3rem; margin-bottom: 6px; }
        .qr-card p { color: #6b7280; font-size: 0.9rem; margin-bottom: 16px; }
        .qr-img { width: 280px; height: 280px; max-width: 100%; border-radius: 12px; margin: 0 auto 16px; display: block; }
        .qr-img.small { width: 200px; height: 200px; }
        .url-box { background: #f3f4f6; padding: 10px 14px; border-radius: 8px; font-family: monospace; font-size: 0.8rem; word-break: break-all; color: #4f46e5; margin-bottom: 14px; }
        .open-btn { display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; }
        .open-btn.green { background: #10b981; }
        .credentials { margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.15); border-radius: 14px; backdrop-filter: blur(10px); text-align: center; }
        .credentials h3 { margin-bottom: 12px; }
        .cred-row { display: inline-block; margin: 8px 16px; font-family: monospace; background: rgba(0,0,0,0.2); padding: 8px 14px; border-radius: 8px; }
        .lang-hint { text-align: center; margin-top: 20px; opacity: 0.8; font-size: 0.85rem; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🛒 Sales & Inventory Platform</h1>
        <p class="subtitle">Scan a QR code with your phone or click to open</p>

        <div class="qr-grid">
          <div class="qr-card pos">
            <div class="qr-icon">📱</div>
            <h2>Mobile POS</h2>
            <p>Scan with your phone camera to open the cash register</p>
            <img class="qr-img" src="${posQr}" alt="POS QR Code" />
            <div class="url-box">${baseUrl}/pos/</div>
            <a href="/pos/" class="open-btn green">Open POS →</a>
          </div>

          <div class="qr-card admin">
            <div class="qr-icon">📊</div>
            <h2>Admin Dashboard</h2>
            <p>Open on this computer to manage your store</p>
            <img class="qr-img small" src="${adminQr}" alt="Admin QR Code" />
            <div class="url-box">${baseUrl}/admin/</div>
            <a href="/admin/" class="open-btn">Open Dashboard →</a>
          </div>
        </div>

        <div class="credentials">
          <h3>🔑 Login Credentials</h3>
          <div class="cred-row">👨‍💼 Admin: <strong>admin / admin123</strong></div>
          <div class="cred-row">🧑‍💼 Vendor: <strong>vendor / vendor123</strong></div>
        </div>

        <p class="lang-hint">🌐 English · Français · العربية supported — use the language button in each app</p>
      </div>
    </body>
    </html>
      `);
    });
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize database and start server
initializeDatabase();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Sales & Inventory Management Platform                 ║
║   📡 Server running on http://0.0.0.0:${PORT}               ║
║                                                            ║
║   📊 Admin Dashboard: http://localhost:${PORT}/admin         ║
║   📱 Mobile POS:      http://localhost:${PORT}/pos           ║
║   🔌 Socket.io:       Real-time updates enabled            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
