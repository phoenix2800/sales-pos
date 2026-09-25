const { v4: uuidv4 } = require('uuid');
const { format } = require('date-fns');

function generateInvoiceNumber() {
  const datePart = format(new Date(), 'yyyyMMdd');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `INV-${datePart}-${randomPart}`;
}

function generateProductCode() {
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

function calculatePagination(page = 1, limit = 20) {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  return {
    page: p,
    limit: l,
    offset: (p - 1) * l
  };
}

function formatCurrency(amount, currency = 'DZD') {
  return `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function calculateDebtAging(debts) {
  const now = new Date();
  const aging = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    days90plus: 0
  };

  debts.forEach(debt => {
    if (debt.status === 'paid') return;
    const dueDate = debt.due_date ? new Date(debt.due_date) : new Date(debt.date);
    const daysDiff = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
    const remaining = debt.amount - (debt.paid_amount || 0);

    if (daysDiff <= 30) aging.current += remaining;
    else if (daysDiff <= 60) aging.days30 += remaining;
    else if (daysDiff <= 90) aging.days60 += remaining;
    else aging.days90plus += remaining;
  });

  return aging;
}

module.exports = {
  generateInvoiceNumber,
  generateProductCode,
  calculatePagination,
  formatCurrency,
  calculateDebtAging,
  uuidv4
};
