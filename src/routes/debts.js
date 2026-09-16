const express = require('express');
const { format, addDays, differenceInDays } = require('date-fns');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { calculatePagination, calculateDebtAging } = require('../utils/helpers');

const router = express.Router();

// GET /api/debts - List all debts
router.get('/', authMiddleware, (req, res) => {
  try {
    const { page = 1, limit = 50, status = 'unpaid', client_id, overdue_only = 'false' } = req.query;
    const { offset, limit: lim } = calculatePagination(page, limit);

    let query = `
      SELECT d.*, c.name as client_name, c.phone as client_phone,
             i.invoice_number, i.total_amount as invoice_total
      FROM debts d
      LEFT JOIN clients c ON d.client_id = c.id
      LEFT JOIN invoices i ON d.invoice_id = i.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND d.status = ?';
      params.push(status);
    }
    if (client_id) {
      query += ' AND d.client_id = ?';
      params.push(client_id);
    }
    if (overdue_only === 'true') {
      const today = format(new Date(), 'yyyy-MM-dd');
      query += ' AND d.due_date < ? AND d.status != ?';
      params.push(today, 'paid');
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    // Simpler approach
    let countSql = 'SELECT COUNT(*) as total FROM debts d WHERE 1=1';
    const countParams = [];
    if (status && status !== 'all') { countSql += ' AND d.status = ?'; countParams.push(status); }
    if (client_id) { countSql += ' AND d.client_id = ?'; countParams.push(client_id); }
    if (overdue_only === 'true') {
      countSql += ' AND d.due_date < ? AND d.status != ?';
      countParams.push(format(new Date(), 'yyyy-MM-dd'), 'paid');
    }
    const total = db.prepare(countSql).get(...countParams).total;

    query += ' ORDER BY d.date DESC LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const debts = db.prepare(query).all(...params);

    // Add days overdue info
    const today = new Date();
    debts.forEach(debt => {
      if (debt.due_date && debt.status !== 'paid') {
        debt.days_overdue = Math.max(0, differenceInDays(today, new Date(debt.due_date)));
      } else {
        debt.days_overdue = 0;
      }
      debt.remaining = debt.amount - (debt.paid_amount || 0);
    });

    // Summary
    const summary = db.prepare(`
      SELECT
        SUM(CASE WHEN status != 'paid' THEN amount - COALESCE(paid_amount, 0) ELSE 0 END) as total_outstanding,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END) as unpaid_count
      FROM debts
    `).get();

    res.json({
      debts,
      summary,
      pagination: { page: parseInt(page), limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (error) {
    console.error('Error fetching debts:', error);
    res.status(500).json({ error: 'Error fetching debts' });
  }
});

// GET /api/debts/summary - Debt summary stats
router.get('/summary/stats', authMiddleware, (req, res) => {
  try {
    const allDebts = db.prepare('SELECT * FROM debts').all();
    const today = new Date();

    let outstanding30 = 0, outstanding60 = 0, outstanding90 = 0, outstanding90plus = 0;
    let totalOutstanding = 0;

    allDebts.forEach(d => {
      if (d.status === 'paid') return;
      const remaining = d.amount - (d.paid_amount || 0);
      totalOutstanding += remaining;

      const dueDate = d.due_date ? new Date(d.due_date) : new Date(d.date);
      const daysDiff = differenceInDays(today, dueDate);
      if (daysDiff <= 30) outstanding30 += remaining;
      else if (daysDiff <= 60) outstanding60 += remaining;
      else if (daysDiff <= 90) outstanding90 += remaining;
      else outstanding90plus += remaining;
    });

    // Top debtors
    const topDebtors = db.prepare(`
      SELECT c.id, c.name, c.phone, c.total_debt, COUNT(d.id) as debt_count
      FROM clients c
      LEFT JOIN debts d ON c.id = d.client_id AND d.status != 'paid'
      WHERE c.total_debt > 0
      GROUP BY c.id
      ORDER BY c.total_debt DESC
      LIMIT 10
    `).all();

    res.json({
      aging: {
        current: outstanding30,
        days31_60: outstanding60,
        days61_90: outstanding90,
        days90_plus: outstanding90plus
      },
      total_outstanding: totalOutstanding,
      top_debtors: topDebtors
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching debt summary' });
  }
});

// GET /api/debts/overdue - Overdue debts (30+ days)
router.get('/overdue/list', authMiddleware, (req, res) => {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    const overdue = db.prepare(`
      SELECT d.*, c.name as client_name, c.phone as client_phone
      FROM debts d
      LEFT JOIN clients c ON d.client_id = c.id
      WHERE d.due_date < ? AND d.status != 'paid'
      ORDER BY d.due_date ASC
    `).all(today);

    overdue.forEach(d => {
      d.days_overdue = differenceInDays(new Date(), new Date(d.due_date));
      d.remaining = d.amount - (d.paid_amount || 0);
    });

    res.json({ debts: overdue, count: overdue.length });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching overdue debts' });
  }
});

// GET /api/debts/client/:id_client - Client's debts
router.get('/client/:id_client', authMiddleware, (req, res) => {
  try {
    const { id_client } = req.params;
    const debts = db.prepare(`
      SELECT d.*, i.invoice_number
      FROM debts d
      LEFT JOIN invoices i ON d.invoice_id = i.id
      WHERE d.client_id = ?
      ORDER BY d.date DESC
    `).all(id_client);

    const payments = db.prepare(`
      SELECT dp.*, d.invoice_id
      FROM debt_payments dp
      LEFT JOIN debts d ON dp.debt_id = d.id
      WHERE d.client_id = ?
      ORDER BY dp.payment_date DESC
    `).all(id_client);

    debts.forEach(d => {
      d.remaining = d.amount - (d.paid_amount || 0);
    });

    res.json({ debts, payments });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching client debts' });
  }
});

// POST /api/debts/pay - Record payment
router.post('/pay', authMiddleware, (req, res) => {
  const trx = db.transaction(() => {
    try {
      const { debt_id, amount, notes } = req.body;

      if (!debt_id || !amount || parseFloat(amount) <= 0) {
        throw new Error('Debt ID and positive amount required');
      }

      const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(debt_id);
      if (!debt) throw new Error('Debt not found');

      const remaining = debt.amount - (debt.paid_amount || 0);
      const paymentAmount = Math.min(parseFloat(amount), remaining);
      const newPaidAmount = (debt.paid_amount || 0) + paymentAmount;
      const newRemaining = debt.amount - newPaidAmount;

      let newStatus = 'partial';
      if (newRemaining <= 0) newStatus = 'paid';

      const today = format(new Date(), 'yyyy-MM-dd');

      db.prepare(
        'INSERT INTO debt_payments (debt_id, amount, payment_date, notes, user_id) VALUES (?, ?, ?, ?, ?)'
      ).run(debt_id, paymentAmount, today, notes || null, req.user.id);

      db.prepare(
        'UPDATE debts SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(newPaidAmount, newStatus, debt_id);

      // Update invoice payment
      if (debt.invoice_id) {
        const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(debt.invoice_id);
        if (invoice) {
          const newInvoicePaid = invoice.amount_paid + paymentAmount;
          const newInvoiceDebt = invoice.total_amount - newInvoicePaid;
          let invoiceStatus = 'paid';
          if (newInvoicePaid === 0) invoiceStatus = 'unpaid';
          else if (newInvoiceDebt > 0) invoiceStatus = 'partial';

          db.prepare('UPDATE invoices SET amount_paid = ?, amount_debt = ?, status = ? WHERE id = ?')
            .run(newInvoicePaid, newInvoiceDebt, invoiceStatus, debt.invoice_id);
        }
      }

      // Update client total_debt
      db.prepare('UPDATE clients SET total_debt = total_debt - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(paymentAmount, debt.client_id);

      // Record in treasury
      db.prepare(
        'INSERT INTO treasury (date, type, amount, description, category, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(today, 'income', paymentAmount, `Debt payment - Debt #${debt_id}`, 'debt_payment', `DEBT-${debt_id}`, req.user.id);

      return { paymentAmount, newStatus, newRemaining };
    } catch (error) {
      throw error;
    }
  });

  try {
    const result = trx();
    const io = req.app.get('io');
    if (io) io.emit('debt:updated');
    res.json({ message: 'Payment recorded', ...result });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
