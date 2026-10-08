/**
 * NexaBank – app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture:
 *   • CONFIG          – API base URL and constants
 *   • MOCK_DATA       – Realistic fallback data when Java server is offline
 *   • STATE           – Single source of truth for all reactive data
 *   • API             – Async fetch wrappers with automatic mock fallback
 *   • FORMATTERS      – Currency, date, masking helpers
 *   • CHARTS          – Chart.js doughnut + bar chart builders
 *   • RENDERERS       – Pure functions that build DOM from data
 *   • HANDLERS        – Event-bound logic (navigation, transfer, filter…)
 *   • INIT            – Bootstrap sequence
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  API_BASE:    '',          // same origin; leave empty for relative paths
  TIMEOUT_MS:  4000,        // ms before falling back to mock data
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA (used when Java server is unavailable)
// ═══════════════════════════════════════════════════════════════════════════════

const MOCK = {
  /** Mirrored from Java BankingService seed data */
  summary: {
    netWorth:        49030.25,
    monthlyIncome:   6782.50,
    monthlyExpenses: 2754.97,
    spendingBreakdown: {
      Rent:          1800.00,
      Food:           299.95,
      Utilities:      145.80,
      Shopping:       329.99,
      Transport:       98.00,
      Healthcare:      54.25,
      Entertainment:   26.98,
    },
    accounts: [
      { id:'acc1', accountNumber:'4521-8800-0012-3456', accountType:'Checking',    balance:12450.75, currency:'USD' },
      { id:'acc2', accountNumber:'4521-8800-0012-7890', accountType:'Savings',     balance:38920.00, currency:'USD' },
      { id:'acc3', accountNumber:'5412-7534-0098-1122', accountType:'Credit Card', balance:-2340.50, currency:'USD' },
    ],
  },

  transactions: (() => {
    const m = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    })();
    return [
      { id:'tx001', accountId:'acc1', type:'CREDIT', category:'Salary',        description:'Monthly salary deposit',           amount:5500.00, date:`${m}-01`, status:'COMPLETED' },
      { id:'tx002', accountId:'acc1', type:'DEBIT',  category:'Rent',          description:'Monthly rent payment',             amount:1800.00, date:`${m}-02`, status:'COMPLETED' },
      { id:'tx003', accountId:'acc1', type:'DEBIT',  category:'Utilities',     description:'Electric & internet bill',          amount: 145.80, date:`${m}-03`, status:'COMPLETED' },
      { id:'tx004', accountId:'acc1', type:'DEBIT',  category:'Food',          description:'Weekly groceries – FreshMart',      amount: 212.35, date:`${m}-04`, status:'COMPLETED' },
      { id:'tx005', accountId:'acc1', type:'DEBIT',  category:'Food',          description:'Dinner – The Capital Grille',       amount:  87.60, date:`${m}-05`, status:'COMPLETED' },
      { id:'tx006', accountId:'acc2', type:'CREDIT', category:'Transfer',      description:'Transfer from Checking to Savings', amount: 500.00, date:`${m}-06`, status:'COMPLETED' },
      { id:'tx007', accountId:'acc3', type:'DEBIT',  category:'Shopping',      description:'Amazon order – electronics',        amount: 329.99, date:`${m}-07`, status:'COMPLETED' },
      { id:'tx008', accountId:'acc1', type:'DEBIT',  category:'Transport',     description:'Monthly transit pass',              amount:  98.00, date:`${m}-08`, status:'COMPLETED' },
      { id:'tx009', accountId:'acc2', type:'CREDIT', category:'Interest',      description:'Savings account interest',          amount:  32.50, date:`${m}-09`, status:'COMPLETED' },
      { id:'tx010', accountId:'acc1', type:'DEBIT',  category:'Healthcare',    description:'Pharmacy – prescriptions',          amount:  54.25, date:`${m}-10`, status:'COMPLETED' },
      { id:'tx011', accountId:'acc3', type:'DEBIT',  category:'Entertainment', description:'Netflix + Spotify subscriptions',    amount:  26.98, date:`${m}-11`, status:'COMPLETED' },
      { id:'tx012', accountId:'acc1', type:'CREDIT', category:'Freelance',     description:'Freelance project payment',         amount: 750.00, date:`${m}-12`, status:'COMPLETED' },
    ];
  })(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATE – single mutable store
// ═══════════════════════════════════════════════════════════════════════════════

const STATE = {
  accounts:       [],   // Account[] from summary
  summary:        null, // Full summary object
  transactions:   [],   // Transaction[]
  balancesHidden: false,// Eye-toggle state
  usingMock:      false,// Flag: true when Java server is offline

  // Active filters (transactions page)
  txFilter: { type: 'all', category: '', search: '' },

  // Chart.js instances (kept to allow destroy on re-render)
  charts: { doughnut: null, doughnutFull: null, bar: null },
};

// ═══════════════════════════════════════════════════════════════════════════════
// API – fetch wrappers with automatic mock fallback
// ═══════════════════════════════════════════════════════════════════════════════

const API = {
  /**
   * Generic fetch with timeout + JSON parse.
   * Throws on non-OK HTTP or timeout.
   */
  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.API_BASE + url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * GET /api/summary
   * Returns: { netWorth, monthlyIncome, monthlyExpenses, spendingBreakdown, accounts }
   * Falls back to MOCK.summary on any error.
   */
  async getSummary() {
    try {
      const data = await this._fetch('/api/summary');
      STATE.usingMock = false;
      return data;
    } catch (err) {
      console.warn('[NexaBank] Java server unreachable – using mock data.', err.message);
      STATE.usingMock = true;
      return MOCK.summary;
    }
  },

  /**
   * GET /api/transactions[?category=...&type=...]
   * Falls back to MOCK.transactions, applying the same filters client-side.
   */
  async getTransactions(params = {}) {
    try {
      const qs  = new URLSearchParams(params).toString();
      const url = '/api/transactions' + (qs ? `?${qs}` : '');
      return await this._fetch(url);
    } catch (_) {
      // Apply filters manually on mock data
      return MOCK.transactions.filter(t => {
        const catOk  = !params.category || t.category.toLowerCase() === params.category.toLowerCase();
        const typeOk = !params.type     || t.type === params.type;
        return catOk && typeOk;
      });
    }
  },

  /**
   * POST /api/transfer
   * Body: { fromAccount, toAccount, amount, note }
   * Returns: { success, message, fromBalance?, toBalance? }
   * Falls back to local balance mutation on mock data.
   */
  async postTransfer({ fromAccount, toAccount, amount, note }) {
    try {
      const result = await this._fetch('/api/transfer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fromAccount, toAccount, amount, note }),
      });
      return result;
    } catch (_) {
      // Simulate transfer on mock data
      const from = STATE.accounts.find(a => a.id === fromAccount);
      const to   = STATE.accounts.find(a => a.id === toAccount);
      if (!from || !to)   return { success: false, message: 'Account not found.' };
      if (from.balance < amount) return { success: false, message: 'Insufficient funds.' };

      from.balance -= amount;
      to.balance   += amount;

      // Append mock transactions
      const today = new Date().toISOString().split('T')[0];
      const txBase = { type:'DEBIT',  category:'Transfer', status:'COMPLETED', date: today };
      MOCK.transactions.unshift({
        ...txBase, id:`txM${Date.now()}a`, accountId: fromAccount,
        description: (note || 'Transfer') + ' (sent)',     amount,
      });
      MOCK.transactions.unshift({
        ...txBase, id:`txM${Date.now()}b`, accountId: toAccount, type:'CREDIT',
        description: (note || 'Transfer') + ' (received)', amount,
      });

      return { success: true, message: `Transferred $${amount.toFixed(2)} successfully.`, fromBalance: from.balance, toBalance: to.balance };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════════

const FMT = {
  /**
   * Format a number as USD currency.
   * @param {number} amount
   * @param {boolean} showSign – prefix + for positive values
   */
  currency(amount, showSign = false) {
    const abs = Math.abs(amount);
    const str = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    if (showSign) return amount < 0 ? `−${str}` : `+${str}`;
    return amount < 0 ? `−${str}` : str;
  },

  /** Format ISO date string to human-readable. */
  date(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch (_) { return dateStr; }
  },

  /** Mask an account number, showing only last 4 digits. */
  maskAccNumber(num) {
    const last4 = num.replace(/\D/g, '').slice(-4);
    return `•••• ${last4}`;
  },

  /** Return "hidden" placeholder when balances are toggled off. */
  maybeMask(value) {
    if (STATE.balancesHidden) return '••••••';
    return value;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Map category → emoji icon */
function catIcon(cat) {
  const map = {
    Salary: '💼', Rent: '🏠', Food: '🍔', Utilities: '⚡',
    Shopping: '🛍️', Transport: '🚌', Entertainment: '🎬',
    Healthcare: '💊', Freelance: '💻', Interest: '📈',
    Transfer: '🔁',
  };
  return map[cat] || '💳';
}

/** Map category → CSS class for badge */
function catClass(cat) {
  const map = {
    Salary:'cat-salary', Rent:'cat-rent', Food:'cat-food',
    Utilities:'cat-utilities', Shopping:'cat-shopping', Transport:'cat-transport',
    Entertainment:'cat-entertainment', Healthcare:'cat-healthcare',
    Freelance:'cat-freelance', Interest:'cat-interest', Transfer:'cat-transfer',
  };
  return map[cat] || 'cat-default';
}

/** Map accountType → CSS class for card gradient */
function accCardClass(type) {
  if (/checking/i.test(type)) return 'checking';
  if (/savings/i.test(type))  return 'savings';
  if (/credit/i.test(type))   return 'credit';
  return 'default-card';
}

/** Map accountType → label emoji */
function accEmoji(type) {
  if (/checking/i.test(type)) return '🏦';
  if (/savings/i.test(type))  return '💰';
  if (/credit/i.test(type))   return '💳';
  return '🏦';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show a toast notification.
 * @param {string} message  – Display text
 * @param {'success'|'error'|'info'} type
 * @param {number} duration – Auto-dismiss after ms (default 3500)
 */
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: '✅',
    error:   '❌',
    info:    'ℹ️',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Shared Chart.js defaults for dark theme */
Chart.defaults.color         = '#64748b';
Chart.defaults.borderColor   = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family   = 'Inter, sans-serif';

/** Colour palette for chart slices */
const CHART_COLORS = [
  '#10b981','#8b5cf6','#f59e0b','#ef4444',
  '#3b82f6','#ec4899','#14b8a6','#f97316',
];

/**
 * Build (or rebuild) the doughnut chart.
 * @param {string} canvasId    – ID of the <canvas> element
 * @param {string} legendId    – ID of the legend container
 * @param {Object} breakdown   – { Category: amount }
 * @param {string} stateKey    – STATE.charts key ('doughnut' | 'doughnutFull')
 */
function buildDoughnutChart(canvasId, legendId, breakdown, stateKey) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy previous instance to avoid canvas reuse errors
  if (STATE.charts[stateKey]) {
    STATE.charts[stateKey].destroy();
    STATE.charts[stateKey] = null;
  }

  const labels = Object.keys(breakdown);
  const values = Object.values(breakdown);
  const total  = values.reduce((s, v) => s + v, 0);

  STATE.charts[stateKey] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data:            values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth:     0,
        hoverOffset:     6,
      }],
    },
    options: {
      cutout:     '72%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${FMT.currency(ctx.parsed)} (${((ctx.parsed/total)*100).toFixed(1)}%)`,
          },
          backgroundColor: '#1e293b',
          titleColor:      '#f1f5f9',
          bodyColor:       '#94a3b8',
          borderColor:     'rgba(255,255,255,0.1)',
          borderWidth:     1,
          padding:         10,
          cornerRadius:    10,
        },
      },
    },
  });

  // Custom HTML legend
  const legendEl = document.getElementById(legendId);
  if (!legendEl) return;
  legendEl.innerHTML = labels.map((lbl, i) => `
    <div class="legend-item">
      <div class="flex items-center gap-2">
        <div class="legend-dot" style="background:${CHART_COLORS[i]}"></div>
        <span class="text-slate-400">${lbl}</span>
      </div>
      <span class="font-semibold text-white">${FMT.currency(values[i])}</span>
    </div>
  `).join('');
}

/**
 * Build (or rebuild) the cashflow bar chart.
 * Simulates last 6 months of income vs expense.
 * @param {Object} summary – { monthlyIncome, monthlyExpenses }
 */
function buildBarChart(summary) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;

  if (STATE.charts.bar) {
    STATE.charts.bar.destroy();
    STATE.charts.bar = null;
  }

  // Generate pseudo-historical data (current month real, previous months simulated)
  const months = [];
  const income  = [];
  const expense = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(d.toLocaleString('en-US', { month: 'short' }));

    if (i === 0) {
      // Current month – use real values
      income.push(summary.monthlyIncome);
      expense.push(summary.monthlyExpenses);
    } else {
      // Simulate ±15% variance around real values
      const variance = () => 0.85 + Math.random() * 0.30;
      income.push(+(summary.monthlyIncome  * variance()).toFixed(2));
      expense.push(+(summary.monthlyExpenses * variance()).toFixed(2));
    }
  }

  STATE.charts.bar = new Chart(canvas, {
    type: 'bar',
    data: {
      labels:   months,
      datasets: [
        {
          label:           'Income',
          data:            income,
          backgroundColor: 'rgba(16,185,129,0.75)',
          borderRadius:    { topLeft: 5, topRight: 5 },
          borderSkipped:   false,
        },
        {
          label:           'Expense',
          data:            expense,
          backgroundColor: 'rgba(239,68,68,0.65)',
          borderRadius:    { topLeft: 5, topRight: 5 },
          borderSkipped:   false,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position:  'top',
          align:     'end',
          labels: {
            boxWidth:    10,
            boxHeight:   10,
            borderRadius: 5,
            padding:      16,
            color:        '#94a3b8',
            font:         { size: 12 },
          },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${FMT.currency(ctx.parsed.y)}` },
          backgroundColor: '#1e293b',
          titleColor:      '#f1f5f9',
          bodyColor:       '#94a3b8',
          borderColor:     'rgba(255,255,255,0.1)',
          borderWidth:     1,
          padding:         10,
          cornerRadius:    10,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#475569' } },
        y: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#475569', callback: v => '$' + (v/1000).toFixed(0) + 'k' },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Update the hero summary cards at the top of the dashboard. */
function renderHero(summary) {
  const savings = summary.monthlyIncome - summary.monthlyExpenses;
  const pct     = summary.monthlyIncome > 0
    ? ((savings / summary.monthlyIncome) * 100).toFixed(1)
    : '0.0';

  // Text values (balance-value spans get blurred when hidden)
  setEl('heroNetWorth',  FMT.currency(summary.netWorth));
  setEl('heroIncome',    FMT.currency(summary.monthlyIncome));
  setEl('heroExpenses',  FMT.currency(summary.monthlyExpenses));
  setEl('heroSavings',   FMT.currency(savings));
  setEl('savingsRatePct', `${pct}%`);

  // Animate the SVG ring
  const ring = document.getElementById('savingsRingCircle');
  if (ring) {
    const pctNum = Math.min(100, Math.max(0, parseFloat(pct)));
    ring.setAttribute('stroke-dasharray', `${pctNum} ${100 - pctNum}`);
  }

  // Mock data notice
  if (STATE.usingMock) {
    const el = document.getElementById('heroNetWorthPct');
    if (el) { el.textContent = 'demo mode'; el.style.color = '#f59e0b'; }
    showToast('Java server offline – showing demo data', 'info', 5000);
  }
}

/**
 * Render account cards into a given container.
 * @param {string} containerId
 * @param {Account[]} accounts
 * @param {boolean} fullCard – true = larger card with action buttons
 */
function renderAccountCards(containerId, accounts, fullCard = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!accounts.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm col-span-3">No accounts found.</p>';
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const cls      = accCardClass(acc.accountType);
    const emoji    = accEmoji(acc.accountType);
    const masked   = FMT.maskAccNumber(acc.accountNumber);
    const balClass = acc.balance < 0 ? 'text-crimson-400' : 'text-white';

    if (fullCard) {
      // Full card variant (Accounts page)
      return `
        <div class="account-card ${cls}">
          <div class="flex items-start justify-between mb-4 relative z-10">
            <div>
              <div class="text-2xl mb-1">${emoji}</div>
              <p class="text-sm font-semibold text-white/90">${acc.accountType}</p>
              <p class="text-xs text-white/50 font-mono mt-0.5">${masked}</p>
            </div>
            <span class="text-xs bg-white/10 text-white/70 border border-white/15 px-2.5 py-1 rounded-full font-medium">${acc.currency}</span>
          </div>
          <div class="relative z-10 mt-6">
            <p class="text-xs text-white/50 mb-1">Available Balance</p>
            <p class="text-2xl font-extrabold balance-value ${balClass}">${FMT.currency(acc.balance)}</p>
          </div>
          <div class="relative z-10 mt-5 flex gap-2">
            <button onclick="openTransferWithAccount('${acc.id}')"
              class="flex-1 text-xs font-semibold py-2 rounded-lg bg-white/10 border border-white/15 text-white hover:bg-white/20 transition-colors">
              Transfer
            </button>
            <button class="flex-1 text-xs font-semibold py-2 rounded-lg bg-white/10 border border-white/15 text-white hover:bg-white/20 transition-colors">
              Details
            </button>
          </div>
        </div>`;
    } else {
      // Compact card (dashboard)
      return `
        <div class="account-card ${cls}">
          <div class="flex items-start justify-between mb-3 relative z-10">
            <div>
              <p class="text-xs font-semibold text-white/60 uppercase tracking-wider">${acc.accountType}</p>
              <p class="text-xs text-white/40 font-mono mt-0.5">${masked}</p>
            </div>
            <span class="text-lg">${emoji}</span>
          </div>
          <div class="relative z-10">
            <p class="text-xl font-extrabold balance-value ${balClass}">${FMT.currency(acc.balance)}</p>
            <p class="text-xs text-white/40 mt-0.5">${acc.currency}</p>
          </div>
        </div>`;
    }
  }).join('');
}

/**
 * Render recent transaction rows (compact, for dashboard widget).
 * @param {Transaction[]} txs
 */
function renderRecentTx(txs) {
  const container = document.getElementById('recentTxContainer');
  if (!container) return;

  const recent = txs.slice(0, 6);
  if (!recent.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm py-4">No transactions yet.</p>';
    return;
  }

  container.innerHTML = recent.map(tx => {
    const isCredit  = tx.type === 'CREDIT';
    const amtClass  = isCredit ? 'text-emerald-400' : 'text-crimson-400';
    const amtPrefix = isCredit ? '+' : '−';
    const bgColor   = isCredit ? 'bg-emerald-500/10' : 'bg-crimson-500/10';
    return `
      <div class="recent-tx-row">
        <div class="tx-icon-circle ${bgColor}">${catIcon(tx.category)}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-white truncate">${tx.description}</p>
          <p class="text-xs text-slate-500">${tx.category} · ${FMT.date(tx.date)}</p>
        </div>
        <span class="text-sm font-bold ${amtClass} flex-shrink-0">${amtPrefix}${FMT.currency(tx.amount)}</span>
      </div>`;
  }).join('');
}

/**
 * Render the full transaction table (Transactions page).
 * @param {Transaction[]} txs
 */
function renderTxTable(txs) {
  const tbody = document.getElementById('txTableBody');
  if (!tbody) return;

  // Update count + totals
  const credits = txs.filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.amount, 0);
  const debits  = txs.filter(t => t.type === 'DEBIT' ).reduce((s, t) => s + t.amount, 0);
  setEl('txCount',  `${txs.length} transaction${txs.length !== 1 ? 's' : ''}`);
  setEl('txTotals', `In: <span class="text-emerald-400 font-semibold">${FMT.currency(credits)}</span>
    &nbsp;Out: <span class="text-crimson-400 font-semibold">${FMT.currency(debits)}</span>`);

  if (!txs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-16 text-center text-slate-500 text-sm">No transactions match your filters.</td></tr>`;
    return;
  }

  // Find account type by ID for display
  const accMap = {};
  STATE.accounts.forEach(a => { accMap[a.id] = a; });

  tbody.innerHTML = txs.map(tx => {
    const isCredit  = tx.type === 'CREDIT';
    const amtClass  = isCredit ? 'text-emerald-400' : 'text-crimson-400';
    const amtPrefix = isCredit ? '+' : '−';
    const acc       = accMap[tx.accountId];
    const accLabel  = acc ? `${acc.accountType} ····${acc.accountNumber.slice(-4)}` : tx.accountId;

    return `
      <tr class="tx-table-row">
        <td class="td-cell text-slate-400 whitespace-nowrap">${FMT.date(tx.date)}</td>
        <td class="td-cell">
          <div class="flex items-center gap-2">
            <span class="text-base">${catIcon(tx.category)}</span>
            <span class="font-medium text-white truncate max-w-xs">${tx.description}</span>
          </div>
        </td>
        <td class="td-cell"><span class="cat-badge ${catClass(tx.category)}">${tx.category}</span></td>
        <td class="td-cell text-xs text-slate-500 whitespace-nowrap">${accLabel}</td>
        <td class="td-cell text-right font-bold ${amtClass} whitespace-nowrap">${amtPrefix}${FMT.currency(tx.amount)}</td>
        <td class="td-cell text-center">
          <span class="text-xs font-medium px-2 py-0.5 rounded-full ${
            tx.status === 'COMPLETED'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-amber-500/10  text-amber-400  border border-amber-500/20'
          }">${tx.status}</span>
        </td>
      </tr>`;
  }).join('');
}

/**
 * Render spending breakdown bars (Analytics page).
 * @param {Object} breakdown – { Category: amount }
 */
function renderSpendBars(breakdown) {
  const container = document.getElementById('spendBars');
  if (!container) return;

  const entries = Object.entries(breakdown).sort(([,a],[,b]) => b - a);
  const max     = entries.length ? entries[0][1] : 1;

  container.innerHTML = entries.map(([cat, val], i) => `
    <div class="spend-bar-row">
      <span class="text-slate-400 text-xs flex items-center gap-1.5">
        <span>${catIcon(cat)}</span><span>${cat}</span>
      </span>
      <div class="spend-bar-track">
        <div class="spend-bar-fill" style="width:0%;background:${CHART_COLORS[i % CHART_COLORS.length]}"
          data-target="${((val/max)*100).toFixed(1)}"></div>
      </div>
      <span class="text-right text-white font-semibold text-xs">${FMT.currency(val)}</span>
    </div>
  `).join('');

  // Animate bars with a small delay
  setTimeout(() => {
    document.querySelectorAll('.spend-bar-fill[data-target]').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  }, 80);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTERING (transactions page)
// ═══════════════════════════════════════════════════════════════════════════════

/** Apply active filters (type, category, search) to STATE.transactions → re-render. */
function applyTxFilters() {
  const { type, category, search } = STATE.txFilter;

  let filtered = STATE.transactions.slice();

  if (type !== 'all')  filtered = filtered.filter(t => t.type === type);
  if (category)        filtered = filtered.filter(t => t.category.toLowerCase() === category.toLowerCase());
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }

  renderTxTable(filtered);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

const SECTION_META = {
  dashboard:    { title: 'Dashboard',    subtitle: 'Good morning, MD Ziauddin 👋' },
  accounts:     { title: 'My Accounts',  subtitle: 'Manage your linked accounts'  },
  transactions: { title: 'Transactions', subtitle: 'Full transaction history'      },
  analytics:    { title: 'Analytics',    subtitle: 'Spending insights & cashflow'  },
  settings:     { title: 'Settings',     subtitle: 'Preferences and security'      },
};

/**
 * Navigate to a section.
 * @param {string} sectionId – one of the SECTION_META keys
 */
function navigateTo(sectionId) {
  if (!SECTION_META[sectionId]) return;

  // Hide all sections
  document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
  // De-activate all nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  // Show target section
  const section = document.getElementById(`section-${sectionId}`);
  if (section) section.classList.remove('hidden');

  // Activate nav link
  const navLink = document.getElementById(`nav-${sectionId}`);
  if (navLink) navLink.classList.add('active');

  // Update topbar
  const meta = SECTION_META[sectionId];
  setEl('pageHeading',    meta.title);
  setEl('pageSubheading', meta.subtitle);

  // Lazy-render sections that need it
  if (sectionId === 'transactions') {
    applyTxFilters();
  }
  if (sectionId === 'accounts') {
    renderAccountCards('accountsPageGrid', STATE.accounts, true);
  }
  if (sectionId === 'analytics') {
    buildDoughnutChart('doughnutChartFull', 'doughnutLegendFull', STATE.summary.spendingBreakdown, 'doughnutFull');
    buildBarChart(STATE.summary);
    renderSpendBars(STATE.summary.spendingBreakdown);
  }

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

/** Open the quick transfer modal. Optionally pre-select a "from" account. */
function openTransferModal(fromAccountId = null) {
  const modal = document.getElementById('transferModal');
  if (!modal) return;

  // Populate account dropdowns
  const fromSel = document.getElementById('fromAccount');
  const toSel   = document.getElementById('toAccount');
  const opts    = STATE.accounts.map(a =>
    `<option value="${a.id}">${a.accountType} ····${a.accountNumber.slice(-4)} (${FMT.currency(a.balance)})</option>`
  ).join('');

  fromSel.innerHTML = opts;
  toSel.innerHTML   = opts;

  // Pre-select if requested
  if (fromAccountId) {
    fromSel.value = fromAccountId;
    // Default "to" = first different account
    const other = STATE.accounts.find(a => a.id !== fromAccountId);
    if (other) toSel.value = other.id;
  } else {
    // Default: first → second
    if (STATE.accounts.length > 1) toSel.selectedIndex = 1;
  }

  // Reset form state
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferNote').value   = '';
  document.getElementById('recipientField').value = '';
  document.getElementById('transferError').classList.add('hidden');
  document.getElementById('transferPreview').classList.add('hidden');

  modal.classList.remove('hidden');
  document.getElementById('transferAmount').focus();
}

/** Close the quick transfer modal. */
function closeTransferModal() {
  document.getElementById('transferModal').classList.add('hidden');
}

/** Update the live balance preview inside the modal. */
function updateTransferPreview() {
  const fromId  = document.getElementById('fromAccount').value;
  const toId    = document.getElementById('toAccount').value;
  const amount  = parseFloat(document.getElementById('transferAmount').value) || 0;
  const preview = document.getElementById('transferPreview');

  if (amount <= 0) { preview.classList.add('hidden'); return; }

  const from = STATE.accounts.find(a => a.id === fromId);
  const to   = STATE.accounts.find(a => a.id === toId);
  if (!from || !to) return;

  const fromAfter = from.balance - amount;
  const toAfter   = to.balance   + amount;

  setEl('previewFrom', FMT.currency(fromAfter));
  setEl('previewTo',   FMT.currency(toAfter));
  preview.classList.remove('hidden');
}

/** Handle transfer form submission. */
async function handleTransferSubmit(e) {
  e.preventDefault();

  const fromAccount = document.getElementById('fromAccount').value;
  const toAccount   = document.getElementById('toAccount').value;
  const amount      = parseFloat(document.getElementById('transferAmount').value);
  const note        = document.getElementById('transferNote').value.trim();
  const errEl       = document.getElementById('transferError');
  const spinner     = document.getElementById('transferSpinner');
  const btnLabel    = document.getElementById('transferBtnLabel');
  const submitBtn   = document.getElementById('transferSubmitBtn');

  // ── Client-side validation ──
  errEl.classList.add('hidden');

  if (fromAccount === toAccount) {
    errEl.textContent = '⚠ Source and destination accounts must be different.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!amount || amount <= 0) {
    errEl.textContent = '⚠ Please enter a valid amount greater than $0.';
    errEl.classList.remove('hidden');
    return;
  }
  const fromAcc = STATE.accounts.find(a => a.id === fromAccount);
  if (fromAcc && fromAcc.balance < amount) {
    errEl.textContent = `⚠ Insufficient funds. Available: ${FMT.currency(fromAcc.balance)}`;
    errEl.classList.remove('hidden');
    return;
  }

  // ── Show loading ──
  submitBtn.disabled = true;
  btnLabel.textContent = 'Processing…';
  spinner.classList.remove('hidden');

  try {
    const result = await API.postTransfer({ fromAccount, toAccount, amount, note });

    spinner.classList.add('hidden');
    submitBtn.disabled = false;
    btnLabel.textContent = 'Send Transfer';

    if (result.success) {
      closeTransferModal();
      showToast(`✅ ${result.message}`, 'success');

      // Update local state so balances refresh immediately
      if (typeof result.fromBalance === 'number') {
        const from = STATE.accounts.find(a => a.id === fromAccount);
        if (from) from.balance = result.fromBalance;
      }
      if (typeof result.toBalance === 'number') {
        const to = STATE.accounts.find(a => a.id === toAccount);
        if (to) to.balance = result.toBalance;
      }

      // Re-render affected areas
      renderAccountCards('dashAccountCards', STATE.accounts, false);
      renderAccountCards('accountsPageGrid', STATE.accounts, true);

      // Reload transactions from server / mock
      const freshTx = await API.getTransactions();
      STATE.transactions = freshTx;
      renderRecentTx(freshTx);
      applyTxFilters();

      // Refresh summary numbers
      const freshSummary = await API.getSummary();
      STATE.summary  = freshSummary;
      STATE.accounts = freshSummary.accounts;
      renderHero(freshSummary);

    } else {
      errEl.textContent = `❌ ${result.message}`;
      errEl.classList.remove('hidden');
      showToast(`❌ ${result.message}`, 'error');
    }
  } catch (err) {
    spinner.classList.add('hidden');
    submitBtn.disabled = false;
    btnLabel.textContent = 'Send Transfer';
    errEl.textContent = '❌ Network error. Please try again.';
    errEl.classList.remove('hidden');
  }
}

// Helper exposed globally so HTML onclick= attributes work
window.openTransferWithAccount = function(accId) {
  openTransferModal(accId);
};

// ═══════════════════════════════════════════════════════════════════════════════
// BALANCE VISIBILITY TOGGLE
// ═══════════════════════════════════════════════════════════════════════════════

function setBalanceVisibility(hidden) {
  STATE.balancesHidden = hidden;
  const body           = document.getElementById('mainContent');
  const eyeShow        = document.getElementById('eyeIconShow');
  const eyeHide        = document.getElementById('eyeIconHide');
  const settingsToggle = document.getElementById('settingsBalToggle');

  if (hidden) {
    body?.classList.add('balance-hidden');
    eyeShow?.classList.add('hidden');
    eyeHide?.classList.remove('hidden');
    settingsToggle?.classList.remove('active');
  } else {
    body?.classList.remove('balance-hidden');
    eyeShow?.classList.remove('hidden');
    eyeHide?.classList.add('hidden');
    settingsToggle?.classList.add('active');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

/** Safely set innerHTML of an element by ID. */
function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS SETUP
// ═══════════════════════════════════════════════════════════════════════════════

function bindEvents() {

  // ── Sidebar nav links ──
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });

  // ── "View All" inline links (dashboard widgets) ──
  document.querySelectorAll('a[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });

  // ── Sidebar toggle (mobile hamburger) ──
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // ── Balance eye toggle ──
  document.getElementById('balanceToggle')?.addEventListener('click', () => {
    setBalanceVisibility(!STATE.balancesHidden);
  });
  document.getElementById('settingsBalToggle')?.addEventListener('click', () => {
    setBalanceVisibility(!STATE.balancesHidden);
  });

  // ── Transfer modal open/close ──
  document.getElementById('openTransferBtn')?.addEventListener('click', () => openTransferModal());
  document.getElementById('closeModalBtn')?.addEventListener('click',   closeTransferModal);
  document.getElementById('cancelTransferBtn')?.addEventListener('click', closeTransferModal);

  // Close modal on overlay click
  document.getElementById('transferModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTransferModal();
  });

  // Transfer form live preview
  ['fromAccount','toAccount','transferAmount'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateTransferPreview);
    document.getElementById(id)?.addEventListener('input',  updateTransferPreview);
  });

  // Transfer form submit
  document.getElementById('transferForm')?.addEventListener('submit', handleTransferSubmit);

  // ── Transaction filter tabs ──
  document.querySelectorAll('.tx-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tx-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.txFilter.type = btn.dataset.filter;
      applyTxFilters();
    });
  });

  // ── Category dropdown filter ──
  document.getElementById('categoryFilter')?.addEventListener('change', e => {
    STATE.txFilter.category = e.target.value;
    applyTxFilters();
  });

  // ── Search input (debounced) ──
  let searchDebounce;
  document.getElementById('txSearch')?.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      STATE.txFilter.search = e.target.value.trim();
      applyTxFilters();
    }, 250);
  });

  // ── Settings toggles (visual only) ──
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'settingsBalToggle') return; // handled separately
      btn.classList.toggle('active');
    });
  });

  // ── Keyboard: Escape closes modal ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeTransferModal();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT – Bootstrap sequence
// ═══════════════════════════════════════════════════════════════════════════════

async function init() {
  // 1. Bind all events first (so UI is interactive even before data loads)
  bindEvents();

  // 2. Fetch summary (accounts + KPIs)
  const summary      = await API.getSummary();
  STATE.summary      = summary;
  STATE.accounts     = summary.accounts;

  // 3. Render hero + account cards
  renderHero(summary);
  renderAccountCards('dashAccountCards', summary.accounts, false);

  // 4. Build small doughnut chart on dashboard
  buildDoughnutChart('doughnutChart', 'doughnutLegend', summary.spendingBreakdown, 'doughnut');

  // 5. Fetch transactions
  const txs          = await API.getTransactions();
  STATE.transactions = txs;

  // 6. Render recent transactions widget
  renderRecentTx(txs);

  // 7. Dashboard is fully loaded
  console.info('[NexaBank] Dashboard loaded. Mock mode:', STATE.usingMock);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
