const express = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { format } = require('date-fns');
const { db } = require('../config/database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { generateInvoiceNumber, calculatePagination } = require('../utils/helpers');

const router = express.Router();

const PDF_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'pdfs');
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// Helper: generate invoice PDF
function generateInvoicePDF(invoice, client, items, res) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [226.77, 600], margin: 10 }); // 80mm width
    const filename = `${invoice.invoice_number}.pdf`;
    const filePath = path.join(PDF_DIR, filename);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Header
    doc.fontSize(14).font('Helvetica-Bold').text('SALES INVOICE', { align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold').text('فاتورة مبيعات', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice #: ${invoice.invoice_number}`);
    doc.text(`Date: ${invoice.date} ${invoice.time}`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    doc.moveDown(0.5);

    // Client info
    doc.fontSize(9).font('Helvetica-Bold').text('Client / العميل:');
    doc.font('Helvetica').text(`${client.name}`);
    if (client.phone) doc.text(`Phone: ${client.phone}`);
    if (client.address) doc.text(`Address: ${client.address}`);
    doc.moveDown(0.5);

    // Divider
    doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
    doc.moveDown(0.3);

    // Items header
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Item              Qty  Price  Total', 10, doc.y, { width: 206 });
    doc.moveTo(10, doc.y + 2).lineTo(216, doc.y + 2).stroke();
    doc.moveDown(0.3);

    // Items
    doc.font('Helvetica').fontSize(8);
    items.forEach(item => {
      const name = item.product_name.length > 16 ? item.product_name.substring(0, 15) + '…' : item.product_name;
      const line = `${name.padEnd(16)} ${String(item.quantity).padStart(3)} ${item.unit_price.toFixed(2).padStart(6)} ${item.total_price.toFixed(2).padStart(7)}`;
      doc.text(line);
    });

    doc.moveDown(0.3);
    doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
    doc.moveDown(0.5);

    // Totals
    doc.fontSize(9);
    doc.font('Helvetica-Bold').text(`Total: ${invoice.total_amount.toFixed(2)} DZD`, { align: 'right' });
    doc.text(`Paid: ${invoice.amount_paid.toFixed(2)} DZD`, { align: 'right' });
    doc.font('Helvetica-Bold').fillColor(invoice.amount_debt > 0 ? 'red' : 'black')
      .text(`Remaining: ${invoice.amount_debt.toFixed(2)} DZD`, { align: 'right' });
    doc.fillColor('black');
    doc.moveDown(1);

    doc.fontSize(8).font('Helvetica').text('Thank you for your business!', { align: 'center' });
    doc.text('شكراً لتسوقكم معنا', { align: 'center' });

    doc.end();

    writeStream.on('finish', () => resolve(`/uploads/pdfs/${filename}`));
    writeStream.on('error', reject);
  });
}

// GET /api/invoices - List all invoices
router.get('/', authMiddleware, (req, res) => {
  try {
    const { page = 1, limit = 50, status, client_id, date_from, date_to, search } = req.query;
    const { offset, limit: lim } = calculatePagination(page, limit);

    let query = `
      SELECT i.*, c.name as client_name, c.phone as client_phone, u.username as created_by_name,
             COUNT(id.id) as items_count
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN invoice_details id ON i.id = id.invoice_id
      WHERE i.is_archived = 0
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND i.status = ?';
      params.push(status);
    }
    if (client_id) {
      query += ' AND i.client_id = ?';
      params.push(client_id);
    }
    if (date_from) {
      query += ' AND i.date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND i.date <= ?';
      params.push(date_to);
    }
    if (search) {
      query += ' AND (i.invoice_number LIKE ? OR c.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    query += ' GROUP BY i.id ORDER BY i.date DESC, i.time DESC';

    const countQuery = query.replace(/SELECT[\s\S]*?GROUP BY/, 'SELECT COUNT(DISTINCT i.id) as total FROM invoices i LEFT JOIN clients c ON i.client_id = c.id LEFT JOIN users u ON i.user_id = u.id LEFT JOIN invoice_details id ON i.id = id.invoice_id WHERE i.is_archived = 0' + query.split('WHERE i.is_archived = 0')[1].split('GROUP BY')[0]);
    // simpler count
    let countWhere = 'WHERE is_archived = 0';
    const countParams = [];
    if (status && status !== 'all') { countWhere += ' AND status = ?'; countParams.push(status); }
    if (client_id) { countWhere += ' AND client_id = ?'; countParams.push(client_id); }
    if (date_from) { countWhere += ' AND date >= ?'; countParams.push(date_from); }
    if (date_to) { countWhere += ' AND date <= ?'; countParams.push(date_to); }

    const total = db.prepare(`SELECT COUNT(*) as total FROM invoices ${countWhere}`).get(...countParams).total;

    query += ' LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const invoices = db.prepare(query).all(...params);

    // For non-admins, remove cost info
    if (req.user.role !== 'admin') {
      invoices.forEach(inv => {
        delete inv.cost_total;
      });
    }

    res.json({
      invoices,
      pagination: { page: parseInt(page), limit: lim, total, pages: Math.ceil(total / lim) }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Error fetching invoices' });
  }
});

// GET /api/invoices/search - Quick search
router.get('/search/query', authMiddleware, (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ invoices: [] });
    const invoices = db.prepare(`
      SELECT i.*, c.name as client_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.is_archived = 0 AND (i.invoice_number LIKE ? OR c.name LIKE ?)
      ORDER BY i.date DESC LIMIT 20
    `).all(`%${q}%`, `%${q}%`);
    res.json({ invoices });
  } catch (error) {
    res.status(500).json({ error: 'Error searching invoices' });
  }
});

// GET /api/invoices/:id - Single invoice with details
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.prepare(`
      SELECT i.*, c.name as client_name, c.phone as client_phone, c.address as client_address, c.email as client_email,
             u.username as created_by_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.id = ?
    `).get(id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const items = db.prepare(`
      SELECT id.*, p.name as product_name, p.code as product_code
      FROM invoice_details id
      LEFT JOIN products p ON id.product_id = p.id
      WHERE id.invoice_id = ?
    `).all(id);

    // Hide cost info for vendors
    if (req.user.role !== 'admin') {
      items.forEach(item => delete item.purchase_price, delete item.profit_margin);
    }

    res.json({ invoice, items });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Error fetching invoice' });
  }
});

// POST /api/invoices - Create new invoice
router.post('/', authMiddleware, async (req, res) => {
  const trx = db.transaction(() => {
    try {
      const { client_id, items = [], amount_paid = 0, notes, payment_type = 'full' } = req.body;

      if (!client_id) {
        return res.status(400).json({ error: 'Client is required' });
      }
      if (!items || items.length === 0) {
        return res.status(400).json({ error: 'At least one item is required' });
      }

      const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }

      let total_amount = 0;
      let total_profit = 0;
      const validatedItems = [];

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
        if (!product) {
          throw new Error(`Product ${item.product_id} not found or inactive`);
        }
        if (product.quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${product.quantity}`);
        }

        const quantity = parseInt(item.quantity);
        const unit_price = item.unit_price || product.selling_price;
        const total_price = unit_price * quantity;
        const profit = (unit_price - product.purchase_price) * quantity;

        total_amount += total_price;
        total_profit += profit;

        validatedItems.push({
          product_id: product.id,
          product_name: product.name,
          quantity,
          unit_price,
          purchase_price: product.purchase_price,
          total_price,
          profit_margin: profit
        });

        // Update stock
        const newQty = product.quantity - quantity;
        db.prepare('UPDATE products SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(newQty, product.id);

        // Record stock history
        db.prepare(
          'INSERT INTO stock_history (product_id, quantity_before, quantity_after, change_type, quantity_change, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(product.id, product.quantity, newQty, 'sale', -quantity, null, req.user.id);
      }

      const paid = Math.min(parseFloat(amount_paid) || 0, total_amount);
      const amount_debt = total_amount - paid;
      let status = 'paid';
      if (paid === 0) status = 'unpaid';
      else if (paid < total_amount) status = 'partial';

      const now = new Date();
      const date = format(now, 'yyyy-MM-dd');
      const time = format(now, 'HH:mm:ss');
      const invoice_number = generateInvoiceNumber();

      // Auto-compute due date for debt (30 days from now)
      const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const dueDateStr = format(dueDate, 'yyyy-MM-dd');

      const invoiceResult = db.prepare(
        `INSERT INTO invoices (invoice_number, client_id, date, time, total_amount, amount_paid, amount_debt, status, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(invoice_number, client_id, date, time, total_amount, paid, amount_debt, status, notes || null, req.user.id);

      const invoiceId = invoiceResult.lastInsertRowid;

      // Insert invoice details
      const insertDetail = db.prepare(
        'INSERT INTO invoice_details (invoice_id, product_id, quantity, unit_price, purchase_price, total_price, profit_margin) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      validatedItems.forEach(item => {
        insertDetail.run(invoiceId, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.total_price, item.profit_margin);
      });

      // Record income in treasury if paid > 0
      if (paid > 0) {
        db.prepare(
          'INSERT INTO treasury (date, type, amount, description, category, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(date, 'income', paid, `Sales invoice ${invoice_number}`, 'sales', invoice_number, req.user.id);
      }

      // Handle debt
      if (amount_debt > 0) {
        db.prepare(
          'INSERT INTO debts (client_id, invoice_id, amount, original_amount, date, due_date, status, paid_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(client_id, invoiceId, amount_debt, amount_debt, date, dueDateStr, 'unpaid', 0);

        // Update client total_debt
        db.prepare('UPDATE clients SET total_debt = total_debt + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(amount_debt, client_id);
      }

      // Generate PDF
      const fullInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      generateInvoicePDF(fullInvoice, client, validatedItems).then(pdfPath => {
        db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(pdfPath, invoiceId);
      }).catch(err => console.error('PDF generation error:', err));

      return { invoiceId, invoice_number, total_amount, amount_paid: paid, amount_debt, status, items: validatedItems };
    } catch (error) {
      throw error;
    }
  });

  try {
    const result = trx();

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      const fullInvoice = db.prepare(`
        SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
      `).get(result.invoiceId);
      io.emit('invoice:created', fullInvoice);
      io.emit('stock:updated');
    }

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: result
    });
  } catch (error) {
    console.error('Invoice creation error:', error);
    res.status(500).json({ error: error.message || 'Error creating invoice' });
  }
});

// GET /api/invoices/:id/print - ESC/POS printable format
router.get('/:id/print', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.prepare(`
      SELECT i.*, c.name as client_name, c.phone as client_phone, c.address as client_address
      FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
    `).get(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const items = db.prepare(`
      SELECT id.*, p.name as product_name FROM invoice_details id
      LEFT JOIN products p ON id.product_id = p.id WHERE id.invoice_id = ?
    `).all(id);

    // Format for 80mm thermal printer (40 chars per line)
    const ESC = '\x1b';
    const lines = [];
    lines.push(ESC + '@'); // Initialize printer
    lines.push(ESC + 'a' + '\x01'); // Center alignment
    lines.push(ESC + 'E' + '\x01'); // Bold on
    lines.push('      SALES INVOICE');
    lines.push('        فاتورة مبيعات');
    lines.push(ESC + 'E' + '\x00'); // Bold off
    lines.push(ESC + 'a' + '\x00'); // Left alignment
    lines.push('----------------------------------------');
    lines.push(`Invoice: ${invoice.invoice_number}`);
    lines.push(`Date: ${invoice.date} ${invoice.time}`);
    lines.push(`Status: ${invoice.status.toUpperCase()}`);
    lines.push('----------------------------------------');
    lines.push(`Client: ${invoice.client_name}`);
    if (invoice.client_phone) lines.push(`Phone: ${invoice.client_phone}`);
    if (invoice.client_address) lines.push(`Add: ${invoice.client_address.substring(0, 36)}`);
    lines.push('----------------------------------------');
    lines.push(ESC + 'E' + '\x01');
    lines.push('Item              Qty  Price    Total');
    lines.push(ESC + 'E' + '\x00');
    items.forEach(item => {
      const name = item.product_name.length > 16 ? item.product_name.substring(0, 15) + '~' : item.product_name.padEnd(16);
      const qty = String(item.quantity).padStart(3);
      const price = item.unit_price.toFixed(0).padStart(6);
      const total = item.total_price.toFixed(0).padStart(7);
      lines.push(`${name}${qty} ${price} ${total}`);
    });
    lines.push('----------------------------------------');
    lines.push(ESC + 'a' + '\x02'); // Right alignment
    lines.push(`TOTAL:     ${invoice.total_amount.toFixed(2)} DZD`);
    lines.push(`PAID:      ${invoice.amount_paid.toFixed(2)} DZD`);
    const debt = invoice.amount_debt > 0;
    if (debt) {
      lines.push(ESC + 'E' + '\x01');
      lines.push(`REMAINING: ${invoice.amount_debt.toFixed(2)} DZD`);
      lines.push(ESC + 'E' + '\x00');
    }
    lines.push('----------------------------------------');
    lines.push(ESC + 'a' + '\x01');
    lines.push('    Thank you for your business!');
    lines.push('       شكراً لتسوقكم معنا');
    lines.push(' ');
    lines.push(' ');
    lines.push(ESC + 'm'); // Partial cut
    lines.push(ESC + 'p' + '\x00' + '\x0c' + '\x19'); // Open drawer

    const escposContent = lines.join('\n');
    res.json({ content: escposContent, invoice, items });
  } catch (error) {
    res.status(500).json({ error: 'Error preparing print data' });
  }
});

// GET /api/invoices/:id/download-pdf
router.get('/:id/download-pdf', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice || !invoice.pdf_path) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    const filePath = path.join(__dirname, '../..', invoice.pdf_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file not found on disk' });
    }
    res.download(filePath, `${invoice.invoice_number}.pdf`);
  } catch (error) {
    res.status(500).json({ error: 'Error downloading PDF' });
  }
});

// DELETE /api/invoices/:id - Archive invoice (soft delete)
router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE invoices SET is_archived = 1 WHERE id = ?').run(id);
    res.json({ message: 'Invoice archived' });
  } catch (error) {
    res.status(500).json({ error: 'Error archiving invoice' });
  }
});

module.exports = router;
