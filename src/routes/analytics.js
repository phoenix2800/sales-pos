const express = require('express');
const { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, differenceInDays } = require('date-fns');
const { getDb } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/analytics/dashboard - Dashboard key metrics
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

    // Today's metrics
    const todaySales = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total_sales,
             COALESCE(SUM(amount_paid), 0) as total_paid,
             COALESCE(SUM(amount_debt), 0) as total_debt,
             COUNT(*) as transaction_count
      FROM invoices WHERE date = ? AND is_archived = 0
    `, [today]);

    // Today's profit (from invoice_details)
    const todayProfit = await getDb().get(`
      SELECT COALESCE(SUM(id.profit_margin), 0) as total_profit
      FROM invoice_details id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date = ? AND i.is_archived = 0
    `, [today]);

    // Today cash flow
    const todayCash = await getDb().get(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
      FROM treasury WHERE date = ?
    `, [today]);

    // Outstanding receivables
    const outstanding = await getDb().get(`
      SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0) as total
      FROM debts WHERE status != 'paid'
    `, []);

    // Low stock items
    const lowStock = await getDb().get(`
      SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND quantity <= 5
    `, []);

    // Total products count
    const totalProducts = await getDb().get('SELECT COUNT(*) as count FROM products WHERE is_active = 1', []);
    const totalClients = await getDb().get('SELECT COUNT(*) as count FROM clients', []);

    // Last 7 days chart data
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayData = await getDb().get(`
        SELECT COALESCE(SUM(total_amount), 0) as sales,
               COALESCE(COUNT(*), 0) as count
        FROM invoices WHERE date = ? AND is_archived = 0
      `, [dateStr]);
      last7Days.push({
        date: dateStr,
        day: format(d, 'EEE'),
        sales: dayData.sales,
        transactions: dayData.count
      });
    }

    // Top 10 best selling products (this month)
    const topProducts = await getDb().all(`
      SELECT p.id, p.name, p.code, p.thumbnail_url,
             SUM(id.quantity) as total_sold,
             SUM(id.total_price) as total_revenue,
             SUM(id.profit_margin) as total_profit
      FROM invoice_details id
      JOIN products p ON id.product_id = p.id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
      GROUP BY p.id ORDER BY total_sold DESC LIMIT 10
    `, [monthStart, monthEnd]);

    // Top 10 best clients (this month)
    const topClients = await getDb().all(`
      SELECT c.id, c.name, c.phone, c.total_debt,
             COUNT(i.id) as purchase_count,
             COALESCE(SUM(i.total_amount), 0) as total_spent
      FROM clients c
      JOIN invoices i ON c.id = i.client_id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
      GROUP BY c.id ORDER BY total_spent DESC LIMIT 10
    `, [monthStart, monthEnd]);

    // Monthly sales
    const monthlySales = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total,
             COALESCE(COUNT(*), 0) as count
      FROM invoices WHERE date BETWEEN ? AND ? AND is_archived = 0
    `, [monthStart, monthEnd]);

    const monthlyProfit = await getDb().get(`
      SELECT COALESCE(SUM(id.profit_margin), 0) as total
      FROM invoice_details id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
    `, [monthStart, monthEnd]);

    res.json({
      today: {
        date: today,
        total_sales: todaySales.total_sales,
        total_paid: todaySales.total_paid,
        total_debt_generated: todaySales.total_debt,
        profit: todayProfit.total_profit,
        transaction_count: todaySales.transaction_count,
        cash_income: todayCash.income,
        cash_expense: todayCash.expense,
        cash_balance: todayCash.income - todayCash.expense
      },
      outstanding_receivables: outstanding.total,
      low_stock_count: lowStock.count,
      total_products: totalProducts.count,
      total_clients: totalClients.count,
      monthly: {
        total_sales: monthlySales.total,
        total_profit: monthlyProfit.total,
        profit_margin: monthlySales.total > 0 ? (monthlyProfit.total / monthlySales.total * 100) : 0,
        transaction_count: monthlySales.count
      },
      last_7_days: last7Days,
      top_products: topProducts,
      top_clients: topClients
    });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({ error: 'Error fetching dashboard data' });
  }
});

// GET /api/analytics/sales/monthly - Monthly sales report
router.get('/sales/monthly', authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const m = month ? parseInt(month) - 1 : now.getMonth();
    const y = year ? parseInt(year) : now.getFullYear();

    const start = format(new Date(y, m, 1), 'yyyy-MM-dd');
    const end = format(endOfMonth(new Date(y, m, 1)), 'yyyy-MM-dd');

    // Daily breakdown for chart
    const daily = await getDb().all(`
      SELECT i.date,
        COALESCE(SUM(i.total_amount), 0) as sales,
        COALESCE(SUM(id.profit_margin), 0) as profit,
        COUNT(i.id) as transactions
      FROM invoices i
      LEFT JOIN invoice_details id ON i.id = id.invoice_id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
      GROUP BY i.date ORDER BY i.date
    `, [start, end]);

    // Product performance
    const productPerformance = await getDb().all(`
      SELECT p.id, p.name, p.code, p.category,
        SUM(id.quantity) as total_quantity,
        SUM(id.total_price) as total_revenue,
        SUM(id.profit_margin) as total_profit,
        p.quantity as current_stock
      FROM invoice_details id
      JOIN products p ON id.product_id = p.id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
      GROUP BY p.id ORDER BY total_revenue DESC
    `, [start, end]);

    const totals = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total_sales,
        COUNT(*) as invoice_count
      FROM invoices WHERE date BETWEEN ? AND ? AND is_archived = 0
    `, [start, end]);

    const totalProfit = await getDb().get(`
      SELECT COALESCE(SUM(id.profit_margin), 0) as total_profit
      FROM invoice_details id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
    `, [start, end]);

    res.json({
      period: { month: m + 1, year: y, start, end },
      daily_breakdown: daily,
      product_performance: productPerformance,
      summary: {
        total_sales: totals.total_sales,
        total_profit: totalProfit.total_profit,
        profit_margin: totals.total_sales > 0 ? (totalProfit.total_profit / totals.total_sales * 100) : 0,
        invoice_count: totals.invoice_count
      }
    });
  } catch (error) {
    console.error('Monthly sales error:', error);
    res.status(500).json({ error: 'Error fetching monthly sales report' });
  }
});

// GET /api/analytics/profit-loss - P&L Statement
router.get('/profit-loss', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const m = month ? parseInt(month) - 1 : now.getMonth();
    const y = year ? parseInt(year) : now.getFullYear();

    const start = format(new Date(y, m, 1), 'yyyy-MM-dd');
    const end = format(endOfMonth(new Date(y, m, 1)), 'yyyy-MM-dd');

    const salesRevenue = await getDb().get(`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM invoices WHERE date BETWEEN ? AND ? AND is_archived = 0
    `, [start, end]).total;

    const costOfGoods = await getDb().get(`
      SELECT COALESCE(SUM(id.purchase_price * id.quantity), 0) as total
      FROM invoice_details id
      JOIN invoices i ON id.invoice_id = i.id
      WHERE i.date BETWEEN ? AND ? AND i.is_archived = 0
    `, [start, end]).total;

    const expenses = await getDb().all(`
      SELECT COALESCE(SUM(amount), 0) as total, category, SUM(amount) as cat_total
      FROM treasury WHERE type = 'expense' AND date BETWEEN ? AND ?
      GROUP BY category
    `, [start, end]);

    const totalExpenses = await getDb().get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM treasury WHERE type = 'expense' AND date BETWEEN ? AND ?
    `, [start, end]).total;

    const grossProfit = salesRevenue - costOfGoods;
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = salesRevenue > 0 ? (netProfit / salesRevenue * 100) : 0;

    // Additional treasury income not from sales (manual income entries)
    const otherIncome = await getDb().get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM treasury WHERE type = 'income' AND category NOT IN ('sales', 'debt_payment') AND date BETWEEN ? AND ?
    `, [start, end]).total;

    res.json({
      period: { month: m + 1, year: y, start, end },
      revenue: {
        sales: salesRevenue,
        other_income: otherIncome,
        total: salesRevenue + otherIncome
      },
      cost_of_goods: costOfGoods,
      gross_profit: grossProfit,
      expenses: {
        total: totalExpenses,
        by_category: expenses
      },
      net_profit: netProfit,
      profit_margin_percentage: profitMargin
    });
  } catch (error) {
    console.error('P&L error:', error);
    res.status(500).json({ error: 'Error generating profit & loss statement' });
  }
});

// GET /api/analytics/inventory - Inventory report
router.get('/inventory', authMiddleware, adminOnly, async (req, res) => {
  try {
    const products = await getDb().all('SELECT * FROM products WHERE is_active = 1 ORDER BY quantity ASC', []);

    const totalValueCost = products.reduce((sum, p) => sum + (p.purchase_price * p.quantity), 0);
    const totalValueRetail = products.reduce((sum, p) => sum + (p.selling_price * p.quantity), 0);
    const totalItems = products.reduce((sum, p) => sum + p.quantity, 0);

    const lowStock = products.filter(p => p.quantity <= 10);
    const outOfStock = products.filter(p => p.quantity === 0);

    // Category breakdown
    const categoryMap = {};
    products.forEach(p => {
      const cat = p.category || 'Uncategorized';
      if (!categoryMap[cat]) categoryMap[cat] = { count: 0, value_cost: 0, value_retail: 0, quantity: 0 };
      categoryMap[cat].count++;
      categoryMap[cat].value_cost += p.purchase_price * p.quantity;
      categoryMap[cat].value_retail += p.selling_price * p.quantity;
      categoryMap[cat].quantity += p.quantity;
    });

    res.json({
      summary: {
        total_products: products.length,
        total_items: totalItems,
        inventory_value_cost: totalValueCost,
        inventory_value_retail: totalValueRetail,
        potential_profit: totalValueRetail - totalValueCost,
        low_stock_count: lowStock.length,
        out_of_stock_count: outOfStock.length
      },
      low_stock: lowStock,
      out_of_stock: outOfStock,
      by_category: categoryMap,
      products: products
    });
  } catch (error) {
    console.error('Inventory report error:', error);
    res.status(500).json({ error: 'Error generating inventory report' });
  }
});

module.exports = router;
