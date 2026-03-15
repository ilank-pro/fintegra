// Fetches the current budget via /api/budget/current and outputs
// transactions + budget metadata + trajectory data as JSON to stdout.
import { RiseUpClient } from '../../../riseup-cli-main/dist/chunk-Q4VJQGQA.js';

const client = new RiseUpClient();
const budget = await client.budget.current();
const txns = budget.envelopes.flatMap(e => e.actuals);

// Use user-overridden category (trackingCategory.name) when available, fall back to system category (expense)
const resolveCategory = (t) => t.trackingCategory?.name || t.expense;

const transactions = txns.map(t => ({
  date: t.transactionDate || t.billingDate || t.originalDate,
  amount: t.isIncome ? (t.incomeAmount || t.billingAmount || 0) : Math.abs(t.billingAmount || 0),
  businessName: t.businessName || '',
  category: t.isIncome ? (resolveCategory(t) || 'income') : (resolveCategory(t) || ''),
  source: t.source || '',
  isIncome: !!t.isIncome,
  isTemp: !!t.isTemp,
}));

const spending = {};
for (const t of txns.filter(tx => !tx.isIncome)) {
  const cat = resolveCategory(t) || 'Other';
  if (!spending[cat]) spending[cat] = { name: cat, total: 0, count: 0 };
  spending[cat].total += Math.abs(t.billingAmount || 0);
  spending[cat].count += 1;
}

const income = txns.filter(tx => tx.isIncome).map(t => ({
  date: t.transactionDate || t.billingDate,
  amount: t.incomeAmount || t.billingAmount || 0,
  businessName: t.businessName || '',
  category: resolveCategory(t) || 'income',
}));

// ── Trajectory data ──────────────────────────────────────────────
const [budgetYear, budgetMonth] = budget.budgetDate.split('-').map(Number);
const startDay = budget.cashflowStartDay || 1;
const now = new Date();
const daysInMonth = new Date(budgetYear, budgetMonth, 0).getDate();
const dayOfMonth = now.getDate();
const daysElapsed = Math.max(1, dayOfMonth - startDay + 1);
const pctMonthElapsed = (daysElapsed / daysInMonth) * 100;

// Build history average lookup from trackingCategoryMetadata
const historyMap = {};
if (Array.isArray(budget.trackingCategoryMetadata)) {
  for (const meta of budget.trackingCategoryMetadata) {
    historyMap[meta.name] = {
      historyAverage: meta.historyAverage || 0,
      basedOnHistoryAverage: !!meta.basedOnHistoryAverage,
    };
  }
}

// Aggregate actual spending by transaction category (not envelope name)
const catAggregated = {};
for (const env of budget.envelopes) {
  const expenses = (env.actuals || []).filter(t => !t.isIncome);
  for (const t of expenses) {
    const catName = resolveCategory(t) || 'Other';
    if (!catAggregated[catName]) catAggregated[catName] = { actual: 0, txnCount: 0 };
    catAggregated[catName].actual += Math.abs(t.billingAmount || 0);
    catAggregated[catName].txnCount += 1;
  }
}

// Add budgeted amounts from envelopes (fixed expenses use envelope details.expense)
for (const env of budget.envelopes) {
  const envCat = env.details?.expense || 'Other';
  if (!catAggregated[envCat]) catAggregated[envCat] = { actual: 0, txnCount: 0 };
  catAggregated[envCat].budgeted = (catAggregated[envCat].budgeted || 0) + (env.originalAmount || 0);
}

// Build trajectory categories
const trajectoryCategories = [];
for (const [catName, data] of Object.entries(catAggregated)) {
  const budgeted = data.budgeted || 0;
  if (data.actual === 0 && budgeted === 0) continue;
  const pctBudgetUsed = budgeted > 0 ? (data.actual / budgeted) * 100 : 0;
  const projected = daysElapsed > 0 ? (data.actual / daysElapsed) * daysInMonth : data.actual;
  const hist = historyMap[catName] || {};

  trajectoryCategories.push({
    name: catName,
    budgeted,
    actual: data.actual,
    projected,
    historyAverage: hist.historyAverage || 0,
    basedOnHistoryAverage: hist.basedOnHistoryAverage || false,
    pctBudgetUsed: Math.round(pctBudgetUsed * 10) / 10,
    onTrack: budgeted > 0 ? pctBudgetUsed <= pctMonthElapsed + 5 : true,
    txnCount: data.txnCount,
  });
}

// Sort by most over-budget first (delta between budget usage % and month elapsed %)
trajectoryCategories.sort((a, b) => {
  const deltaA = a.pctBudgetUsed - pctMonthElapsed;
  const deltaB = b.pctBudgetUsed - pctMonthElapsed;
  return deltaB - deltaA;
});

// ── Cash Flow Trajectory ─────────────────────────────────────────────
let actualIncome = 0, actualExpenses = 0;
let expectedIncome = 0, expectedExpenses = 0;
const pendingItems = [];

for (const env of budget.envelopes) {
  const actuals = env.actuals || [];
  const hasActuals = actuals.length > 0;
  const isIncome = env.details?.isIncome || actuals.some(t => t.isIncome);
  const amt = env.originalAmount || 0;

  if (hasActuals) {
    for (const t of actuals) {
      if (t.isIncome) actualIncome += (t.incomeAmount || t.billingAmount || 0);
      else actualExpenses += Math.abs(t.billingAmount || 0);
    }
  } else if (amt > 0) {
    if (isIncome) {
      expectedIncome += amt;
    } else {
      expectedExpenses += amt;
      pendingItems.push({
        name: env.details?.businessName || env.details?.expense || 'Unknown',
        amount: amt,
        date: env.details?.transactionDate?.slice(0, 10) || null,
        category: env.details?.expense || '',
      });
    }
  }
}

// Sort pending by date
pendingItems.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

const cashflow = {
  actualIncome,
  expectedIncome,
  totalIncome: actualIncome + expectedIncome,
  actualExpenses,
  expectedExpenses,
  totalExpenses: actualExpenses + expectedExpenses,
  projectedNet: (actualIncome + expectedIncome) - (actualExpenses + expectedExpenses),
  pendingExpenses: pendingItems,
  pendingIncome: [], // none currently, but keeping for structure
};

const trajectory = {
  budgetDate: budget.budgetDate,
  cashflowStartDay: startDay,
  daysElapsed,
  daysInMonth,
  pctMonthElapsed: Math.round(pctMonthElapsed * 10) / 10,
  categories: trajectoryCategories,
  cashflow,
  variableIncomePrediction: budget.params?.variableIncomePredictionAmount || null,
};

console.log(JSON.stringify({
  budgetDate: budget.budgetDate,
  cashflowStartDay: budget.cashflowStartDay,
  lastUpdatedAt: budget.lastUpdatedAt,
  transactions,
  spending: Object.values(spending).sort((a, b) => b.total - a.total),
  income,
  totalIncome: txns.filter(tx => tx.isIncome).reduce((s, t) => s + (t.incomeAmount || t.billingAmount || 0), 0),
  totalExpenses: txns.filter(tx => !tx.isIncome).reduce((s, t) => s + Math.abs(t.billingAmount || 0), 0),
  trajectory,
}));
