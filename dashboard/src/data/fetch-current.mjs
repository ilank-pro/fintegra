// Fetches the current budget via /api/budget/current and outputs
// transactions + budget metadata as JSON to stdout.
import { RiseUpClient } from '../../../riseup-cli-main/dist/chunk-Q4VJQGQA.js';

const client = new RiseUpClient();
const budget = await client.budget.current();
const txns = budget.envelopes.flatMap(e => e.actuals);

const transactions = txns.map(t => ({
  date: t.transactionDate || t.billingDate || t.originalDate,
  amount: t.isIncome ? (t.incomeAmount || t.billingAmount || 0) : Math.abs(t.billingAmount || 0),
  businessName: t.businessName || '',
  category: t.isIncome ? (t.expense || 'income') : (t.expense || ''),
  source: t.source || '',
  isIncome: !!t.isIncome,
  isTemp: !!t.isTemp,
}));

const spending = {};
for (const t of txns.filter(tx => !tx.isIncome)) {
  const cat = t.expense || 'Other';
  if (!spending[cat]) spending[cat] = { name: cat, total: 0, count: 0 };
  spending[cat].total += Math.abs(t.billingAmount || 0);
  spending[cat].count += 1;
}

const income = txns.filter(tx => tx.isIncome).map(t => ({
  date: t.transactionDate || t.billingDate,
  amount: t.incomeAmount || t.billingAmount || 0,
  businessName: t.businessName || '',
  category: t.expense || 'income',
}));

console.log(JSON.stringify({
  budgetDate: budget.budgetDate,
  cashflowStartDay: budget.cashflowStartDay,
  lastUpdatedAt: budget.lastUpdatedAt,
  transactions,
  spending: Object.values(spending).sort((a, b) => b.total - a.total),
  income,
  totalIncome: txns.filter(tx => tx.isIncome).reduce((s, t) => s + (t.incomeAmount || t.billingAmount || 0), 0),
  totalExpenses: txns.filter(tx => !tx.isIncome).reduce((s, t) => s + Math.abs(t.billingAmount || 0), 0),
}));
