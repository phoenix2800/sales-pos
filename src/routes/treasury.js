const express = require('express');
const { format, startOfMonth, endOfMonth, parseISO } = require('date-fns');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { calculatePagination } = require('../utils/helpers');

const router = express.Router();

// POST /api/cashier/income - Record income
router.post('/income', authMiddleware, async (req, res) => {
  try {
    const { amount, description, category } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const date = format(new Date(), 'yyyy-MM-dd');
    const result = await getDb().run('INSERT INTO treasury (date, type, amount, description, category, user_id) VALUES (?, ?, ?, ?, ?, ?)', [date, 'income', parseFloat(amount), description || null, category || 'other', req.user.id]);

    const entry = await getDb().get('SELECT * FROM treasury WHERE id = ?', [result.lastID]);

    const io = req.app.get('io');
    if (io) io.emit('treasury:updated');

    res.status(201).json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error recording income' });
  }
});

// POST /api/cashier/expense - Record expense (Admin only)
router.post('/expense', authMiddleware, async (req, res) => {
  try {
    const { amount, description, category } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const date = format(new Date(), 'yyyy-MM-dd');
    const result = await getDb().run('INSERT INTO treasury (date, type, amount, description, category, user_id) VALUES (?, ?, ?, ?, ?, ?)', [date, 'expense', parseFloat(amount), description || null, category || 'other', req.user.id]);

    const entry = await getDb().get('SELECT * FROM treasury WHERE id = ?', [result.lastID]);

    const io = req.app.get('io');
    if (io) io.emit('treasury:updated');

    res.status(201).json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error recording expense' });
  }
});

// GET /api/cashier/daily - Daily summary
router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || format(new Date(), 'yyyy-MM-dd');

    const entries = await getDb().all(`
      SELECT t.*, u.username as user_name
      FROM treasury t LEFT JOIN users u ON t.user_id = u.id
      WHERE t.date = ? ORDER BY t.created_at DESC
    `, [targetDate]);

    const totalIncome = entries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
    const totalExpense = entries.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
    const balance = totalIncome - totalExpense;

    // Include sales invoices for the day
    const daySales = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total_sales,
             COALESCE(SUM(amount_paid), 0) as total_paid,
             COUNT(*) as invoice_count
      FROM invoices WHERE date = ? AND is_archived = 0
    `, [targetDate]);

    res.json({
      date: targetDate,
      entries,
      summary: {
        total_income: totalIncome,
        total_expense: totalExpense,
        balance,
        sales_total: daySales.total_sales,
        sales_paid: daySales.total_paid,
        invoice_count: daySales.invoice_count
      }
    });
  } catch (error) {
    console.error('Daily report error:', error);
    res.status(500).json({ error: 'Error fetching daily report' });
  }
});

// GET /api/cashier/monthly - Monthly summary
router.get('/monthly', authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const targetMonth = month ? parseInt(month) - 1 : now.getMonth();
    const targetYear = year ? parseInt(year) : now.getFullYear();

    const start = format(new Date(targetYear, targetMonth, 1), 'yyyy-MM-dd');
    const end = format(endOfMonth(new Date(targetYear, targetMonth, 1)), 'yyyy-MM-dd');

    // Daily breakdown
    const dailyBreakdown = await getDb().all(`
      SELECT date,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
      FROM treasury
      WHERE date BETWEEN ? AND ?
      GROUP BY date ORDER BY date
    `, [start, end]);

    // Sales breakdown
    const salesBreakdown = await getDb().all(`
      SELECT date,
        COALESCE(SUM(total_amount), 0) as sales_total,
        COALESCE(SUM(amount_paid), 0) as sales_paid,
        COALESCE(SUM(amount_debt), 0) as sales_debt,
        COUNT(*) as invoice_count
      FROM invoices
      WHERE date BETWEEN ? AND ? AND is_archived = 0
      GROUP BY date ORDER BY date
    `, [start, end]);

    const totalIncome = await getDb().get("SELECT COALESCE(SUM(amount), 0) as total FROM treasury WHERE type = 'income' AND date BETWEEN ? AND ?", [start, end]).total;
    const totalExpense = await getDb().get("SELECT COALESCE(SUM(amount), 0) as total FROM treasury WHERE type = 'expense' AND date BETWEEN ? AND ?", [start, end]).total;

    const monthlySales = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total_sales,
             COALESCE(SUM(amount_paid), 0) as total_paid,
             COALESCE(SUM(amount_debt), 0) as total_debt,
             COUNT(*) as invoice_count
      FROM invoices WHERE date BETWEEN ? AND ? AND is_archived = 0
    `, [start, end]);

    res.json({
      period: { month: targetMonth + 1, year: targetYear, start, end },
      daily_breakdown: dailyBreakdown,
      sales_breakdown: salesBreakdown,
      summary: {
        total_income: totalIncome,
        total_expense: totalExpense,
        net_cashflow: totalIncome - totalExpense,
        total_sales: monthlySales.total_sales,
        total_paid: monthlySales.total_paid,
        total_debt_generated: monthlySales.total_debt,
        invoice_count: monthlySales.invoice_count
      }
    });
  } catch (error) {
    console.error('Monthly report error:', error);
    res.status(500).json({ error: 'Error fetching monthly report' });
  }
});

// GET /api/cashier/entries - List entries with filters
router.get('/entries/list', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 50, type, date_from, date_to } = req.query;
    const { offset, limit: lim } = calculatePagination(page, limit);

    let query = `
      SELECT t.*, u.username as user_name
      FROM treasury t LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'all') {
      query += ' AND t.type = ?';
      params.push(type);
    }
    if (date_from) {
      query += ' AND t.date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND t.date <= ?';
      params.push(date_to);
    }

    const countSql = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const tr = await getDb().get(countSql, params);
    const total = tr.total;

    query += ' ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const entries = await getDb().all(query, params);

    res.json({
      entries,
      pagination: { page: parseInt(page), limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching entries' });
  }
});

// GET /api/cashier/export/daily - Export daily report PDF
router.get('/export/daily', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || format(new Date(), 'yyyy-MM-dd');
    const entries = await getDb().all('SELECT * FROM treasury WHERE date = ? ORDER BY created_at', [targetDate]);

    const totalIncome = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const totalExpense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=daily-report-${targetDate}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text('Daily Cash Report / تقرير الصندوق اليومي', { align: 'center' });
    doc.fontSize(12).text(`Date: ${targetDate}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(14).text('Summary / الملخص');
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Total Income / إجمالي الإيرادات: ${totalIncome.toFixed(2)} DZD`);
    doc.text(`Total Expenses / إجمالي المصروفات: ${totalExpense.toFixed(2)} DZD`);
    doc.text(`Balance / الرصيد: ${(totalIncome - totalExpense).toFixed(2)} DZD`);
    doc.moveDown(2);

    doc.fontSize(14).text('Entries / القيود');
    doc.moveDown(0.5);
    entries.forEach(e => {
      doc.fontSize(10).text(
        `[${e.created_at}] ${e.type.toUpperCase()} - ${e.amount.toFixed(2)} DZD - ${e.description || '-'}`
      );
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Error exporting PDF' });
  }
});

module.exports = router;
