const express = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { format } = require('date-fns');
const { getDb } = require('../config/db');
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
      const iname = item.product_name || '';
      const name = iname.length > 16 ? iname.substring(0, 15) + '…' : iname;
      const line = `${name.padEnd(16)} ${String(item.quantity||0).padStart(3)} ${Number(item.unit_price||0).toFixed(2).padStart(6)} ${Number(item.total_price||0).toFixed(2).padStart(7)}`;
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
router.get('/', authMiddleware, async (req, res) => {
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

    const totalRow = await getDb().get(`SELECT COUNT(*) as total FROM invoices ${countWhere}`, [...countParams]);
    const total = totalRow.total;

    query += ' LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const invoices = await getDb().all(query, params);

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
router.get('/search/query', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ invoices: [] });
    const invoices = await getDb().all(`
      SELECT i.*, c.name as client_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.is_archived = 0 AND (i.invoice_number LIKE ? OR c.name LIKE ?)
      ORDER BY i.date DESC LIMIT 20
    `, [`%${q}%`, `%${q}%`]);
    res.json({ invoices });
  } catch (error) {
    res.status(500).json({ error: 'Error searching invoices' });
  }
});

// GET /api/invoices/:id - Single invoice with details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await getDb().get(`
      SELECT i.*, c.name as client_name, c.phone as client_phone, c.address as client_address, c.email as client_email,
             u.username as created_by_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.id = ?
    `, [id]);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const items = await getDb().all(`
      SELECT id.*, p.name as product_name, p.code as product_code
      FROM invoice_details id
      LEFT JOIN products p ON id.product_id = p.id
      WHERE id.invoice_id = ?
    `, [id]);

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
  try {
    const { client_id, items = [], amount_paid = 0, notes, payment_type = 'full' } = req.body;

    if (!client_id) return res.status(400).json({ error: 'Client is required' });
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

    const client = await getDb().get('SELECT * FROM clients WHERE id = ?', [client_id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let total_amount = 0;
    const validatedItems = [];

    for (const item of items) {
      const product = await getDb().get('SELECT * FROM products WHERE id = ? AND is_active = 1', [item.product_id]);
      if (!product) throw new Error(`Product ${item.product_id} not found or inactive`);
      if (product.quantity < item.quantity) throw new Error(`Insufficient stock for ${product.name}. Available: ${product.quantity}`);

      const quantity = parseInt(item.quantity);
      const unit_price = item.unit_price || product.selling_price;
      const total_price = unit_price * quantity;
      const profit = (unit_price - product.purchase_price) * quantity;
      total_amount += total_price;

      validatedItems.push({
        product_id: product.id, quantity, unit_price,
        purchase_price: product.purchase_price, total_price, profit_margin: profit
      });

      const newQty = product.quantity - quantity;
      await getDb().run('UPDATE products SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, product.id]);
      await getDb().run('INSERT INTO stock_history (product_id, quantity_before, quantity_after, change_type, quantity_change, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [product.id, product.quantity, newQty, 'sale', -quantity, null, req.user.id]);
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
    const dueDateStr = format(new Date(now.getTime() + 30*86400000), 'yyyy-MM-dd');

    const invoiceResult = await getDb().run(
      `INSERT INTO invoices (invoice_number, client_id, date, time, total_amount, amount_paid, amount_debt, status, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoice_number, client_id, date, time, total_amount, paid, amount_debt, status, notes || null, req.user.id]
    );
    const invoiceId = invoiceResult.lastID;

    for (const item of validatedItems) {
      await getDb().run('INSERT INTO invoice_details (invoice_id, product_id, quantity, unit_price, purchase_price, total_price, profit_margin) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [invoiceId, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.total_price, item.profit_margin]);
    }

    if (paid > 0) {
      await getDb().run('INSERT INTO treasury (date, type, amount, description, category, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [date, 'income', paid, `Sales invoice ${invoice_number}`, 'sales', invoice_number, req.user.id]);
    }

    if (amount_debt > 0) {
      await getDb().run('INSERT INTO debts (client_id, invoice_id, amount, original_amount, date, due_date, status, paid_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [client_id, invoiceId, amount_debt, amount_debt, date, dueDateStr, 'unpaid', 0]);
      await getDb().run('UPDATE clients SET total_debt = total_debt + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount_debt, client_id]);
    }

    // Generate PDF in background (fire-and-forget, update path when done)
    getDb().get('SELECT * FROM invoices WHERE id = ?', [invoiceId]).then(fullInvoice => {
      generateInvoicePDF(fullInvoice, client, validatedItems).then(pdfPath => {
        getDb().run('UPDATE invoices SET pdf_path = ? WHERE id = ?', [pdfPath, invoiceId]).catch(()=>{});
      }).catch(err => console.error('PDF error:', err));
    });

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      const fullInvoice = await getDb().get(
        'SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?',
        [invoiceId]
      );
      io.emit('invoice:created', fullInvoice);
      io.emit('stock:updated');
    }

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: { invoiceId, invoice_number, total_amount, amount_paid: paid, amount_debt, status, items: validatedItems }
    });
  } catch (error) {
    console.error('Invoice creation error:', error);
    res.status(500).json({ error: error.message || 'Error creating invoice' });
  }
});

// GET /api/invoices/:id/print - Returns HTML receipt for browser printing
router.get('/:id/print', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await getDb().get(`
      SELECT i.*, c.name as client_name, c.phone as client_phone, c.address as client_address
      FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
    `, [id]);
    if (!invoice) return res.status(404).send('Invoice not found');

    const items = await getDb().all(`
      SELECT id.*, p.name as product_name FROM invoice_details id
      LEFT JOIN products p ON id.product_id = p.id WHERE id.invoice_id = ?
    `, [id]);

    // Build items rows
    let itemsHtml = '';
    items.forEach(item => {
      const name = item.product_name.length > 22 ? item.product_name.substring(0, 21) + '…' : item.product_name;
      itemsHtml += `
        <div style="font-size:12px;">
          <div>${name}</div>
          <div style="display:flex;justify-content:space-between;font-size:11px;">
            <span>${item.quantity} × ${Number(item.unit_price).toLocaleString()} DZD</span>
            <span><strong>${Number(item.total_price).toLocaleString()} DZD</strong></span>
          </div>
        </div>`;
    });

    const debtRow = invoice.amount_debt > 0
      ? `<div style="display:flex;justify-content:space-between;color:#c00;font-weight:bold;"><span>Remaining / متبقي:</span><span>${Number(invoice.amount_debt).toLocaleString()} DZD</span></div>`
      : '';

    const phoneRow = invoice.client_phone ? `<div>📞 ${invoice.client_phone}</div>` : '';
    const addrRow = invoice.client_address ? `<div>📍 ${invoice.client_address}</div>` : '';

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${invoice.invoice_number}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Courier New', monospace; }
  body { width: 74mm; margin: 0 auto; font-size: 12px; color: #000; padding: 2mm; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .sep { border-top: 1px dashed #000; margin: 3mm 0; }
  @media print { .no-print { display: none !important; } body { width: 74mm; } }
  .no-print { position: fixed; top: 10px; left: 10px; padding: 10px 20px;
    background: #4f46e5; color: white; border: none; border-radius: 6px;
    font-size: 14px; cursor: pointer; font-family: sans-serif; z-index:999;}
</style></head><body>
<button class="no-print" onclick="window.print()">🖨️ Print / طباعة</button>
<div style="padding-top:30px;">
<div class="center bold">SALES INVOICE</div>
<div class="center bold">فاتورة مبيعات</div>
<div style="font-size:11px;margin-top:2mm;" class="center">${invoice.invoice_number}</div>
<div style="font-size:10px;margin-top:1mm;" class="center">${invoice.date} ${invoice.time}</div>
<div class="sep"></div>
<div><strong>Client / العميل:</strong> ${invoice.client_name}</div>
${phoneRow}${addrRow}
<div class="sep"></div>
<div class="bold" style="margin-bottom:2mm;">Items / المنتجات</div>
${itemsHtml}
<div class="sep"></div>
<div style="display:flex;justify-content:space-between;"><span>Total:</span><span><strong>${Number(invoice.total_amount).toLocaleString()} DZD</strong></span></div>
<div style="display:flex;justify-content:space-between;"><span>Paid / مدفوع:</span><span>${Number(invoice.amount_paid).toLocaleString()} DZD</span></div>
${debtRow}
<div class="sep"></div>
<div class="center">شكراً لتسوقكم معنا</div>
<div class="center">Thank you for your business!</div>
<div style="height:8mm;"></div>
</div>
<script>
window.onload = function() { setTimeout(function() { window.print(); }, 400); };
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Print error:', error);
    res.status(500).send('Error preparing receipt');
  }
});

// GET /api/invoices/:id/download-pdf
router.get('/:id/download-pdf', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await getDb().get('SELECT * FROM invoices WHERE id = ?', [id]);
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
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await getDb().run('UPDATE invoices SET is_archived = 1 WHERE id = ?', [id]);
    res.json({ message: 'Invoice archived' });
  } catch (error) {
    res.status(500).json({ error: 'Error archiving invoice' });
  }
});

module.exports = router;
