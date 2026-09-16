const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/db');
const { authMiddleware, generateToken, adminOnly } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/signup - Register new user (Admin only)
router.post('/signup', authMiddleware, adminOnly, async (req, res) => {
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

    const existing = await getDb().get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await getDb().run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, email, hashedPassword, role]);

    const user = await getDb().get('SELECT id, username, email, role, status FROM users WHERE id = ?', [result.lastID]);
    const token = generateToken(user);

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getDb().get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
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
router.get('/profile', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users - List users (Admin only)
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const users = await getDb().all('SELECT id, username, email, role, status, created_at FROM users ORDER BY created_at DESC', []);
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// PUT /api/auth/users/:id - Update user role/status (Admin only)
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;

    if (role && !['admin', 'vendor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (status && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await getDb().run('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role || null, status || null, id]);

    const user = await getDb().get('SELECT id, username, email, role, status FROM users WHERE id = ?', [id]);
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Error updating user' });
  }
});

// POST /api/auth/users/:id/reset-password - Reset password (Admin only)
router.post('/users/:id/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const hashed = bcrypt.hashSync(password, 10);
    await getDb().run('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashed, id]);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error resetting password' });
  }
});

// PUT /api/auth/change-password - Change own password
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
    const user = await getDb().get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(currentPassword || '', user.password)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hashed = bcrypt.hashSync(newPassword, 10);
    await getDb().run('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashed, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error changing password' });
  }
});

module.exports = router;
