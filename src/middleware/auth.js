const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production-2024';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function authMiddleware(req, res, next) {
  try {
    let token;
    // 1. Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    // 2. Query parameter (?token=...) for popup windows
    if (!token && req.query.token) {
      token = req.query.token;
    }
    // 3. Cookie (auto-sent by browser on all requests including popups)
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    // 4. Socket.io handshake
    if (!token && req.handshake?.auth?.token) {
      token = req.handshake.auth.token;
    }

    if (!token) return res.status(401).json({ error: 'No token provided, access denied' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getDb().get('SELECT id, username, email, role, status FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account is deactivated' });

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { authMiddleware, adminOnly, generateToken, JWT_SECRET };
