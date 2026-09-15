const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { authMiddleware, generateToken, adminOnly } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/signup - Register new user (Admin only)
router.post('/signup', authMiddleware, adminOnly, (req, res) => {
  try {
    const { username, email, password, role = 'vendor' } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!['admin', 'vendor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
    ).run(username, email, hashedPassword, role);

    const user = db.prepare('SELECT id, username, email, role, status FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = generateToken(user);

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    const { password: _, ...userData } = user;

    res.json({ user: userData, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// GET /api/auth/profile
router.get('/profile', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users - List users (Admin only)
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, email, role, status, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// PUT /api/auth/users/:id - Update user role/status (Admin only)
router.put('/users/:id', authMiddleware, adminOnly, (req, res) => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;

    if (role && !['admin', 'vendor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (status && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    db.prepare('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(role || null, status || null, id);

    const user = db.prepare('SELECT id, username, email, role, status FROM users WHERE id = ?').get(id);
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Error updating user' });
  }
});

module.exports = router;
