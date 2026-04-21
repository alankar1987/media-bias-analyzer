const API_BASE_H = typeof API_BASE !== 'undefined' ? API_BASE : 'https://media-bias-analyzer-production.up.railway.app';

let _historyOffset = 0;
const _PAGE_SIZE = 20;

function showHistoryView() {
  document.getElementById('history-view').hidden = false;
  const hero = document.querySelector('.hero');
  if (hero) hero.hidden = true;
  const results = document.getElementById('results');
  if (results) results.classList.add('hidden');
  const compareResults = document.getElementById('compare-results');
  if (compareResults) compareResults.classList.add('hidden');
  const dropdown = document.getElementById('auth-dropdown');
  if (dropdown) dropdown.setAttribute('hidden', '');
  _historyOffset = 0;
  document.getElementById('history-grid').innerHTML = '';
  document.getElementById('history-stats').innerHTML = '';
  document.getElementById('history-drawer').hidden = true;
  loadHistory();
}

function hideHistoryView() {
  document.getElementById('history-view').hidden = true;
  const hero = document.querySelector('.hero');
  if (hero) hero.hidden = false;
}

async function loadHistory() {
  const token = typeof getToken === 'function' ? getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(
      `${API_BASE_H}/auth/history?offset=${_historyOffset}&limit=${_PAGE_SIZE}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const { items } = await res.json();
    if (_historyOffset === 0) renderStats(items);
    renderCards(items);
    _historyOffset += items.length;
    document.getElementById('history-load-more').hidden = items.length < _PAGE_SIZE;
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

function renderStats(items) {
  const el = document.getElementById('history-stats');
  if (!items.length) {
    el.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;grid-column:1/-1">No analyses yet.</p>';
    return;
  }
  const total = items.length;
  const withScore = items.filter(i => i.fact_score != null);
  const avgScore = withScore.length
    ? Math.round(withScore.reduce((s, i) => s + i.fact_score, 0) / withScore.length)
    : 0;
  const leanCounts = {};
  items.forEach(i => { if (i.lean_label) leanCounts[i.lean_label] = (leanCounts[i.lean_label] || 0) + 1; });
  const topLean = Object.entries(leanCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value cyan">${total}</div>
      <div class="stat-label">Analyzed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value purple">${topLean}</div>
      <div class="stat-label">Avg Lean</div>
    </div>
    <div class="stat-card">
      <div class="stat-value green">${avgScore || '—'}</div>
      <div class="stat-label">Avg Score</div>
    </div>
  `;
}

function leanPosition(numeric) {
  if (numeric == null) return 50;
  return Math.round(((numeric + 10) / 20) * 100);
}

function scoreColor(score) {
  if (score == null) return 'rgba(255,255,255,0.5)';
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#d97706';
  return '#ef4444';
}

function escapeH(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCards(items) {
  const grid = document.getElementById('history-grid');
  items.forEach(item => {
    const pos = leanPosition(item.lean_numeric);
    const color = scoreColor(item.fact_score);
    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const card = document.createElement('div');
    card.className = 'history-card glass-card';
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="hcard-outlet">${escapeH(item.source_name || 'Unknown')}</div>
      <div class="hcard-headline">${escapeH(item.headline || item.url || 'Untitled')}</div>
      <div class="lean-bar">
        <div class="lean-dot" style="left:${pos}%"></div>
      </div>
      <div class="hcard-meta">
        <span class="hcard-lean">${escapeH(item.lean_label || '—')}</span>
        <span class="hcard-score" style="color:${color}">${item.fact_score != null ? item.fact_score + '/100' : '—'}</span>
        <span class="hcard-date">${date}</span>
      </div>
    `;
    card.addEventListener('click', () => openHistoryDrawer(item.id));
    grid.appendChild(card);
  });
}

async function openHistoryDrawer(id) {
  const token = typeof getToken === 'function' ? getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE_H}/auth/history/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const row = await res.json();
    const lean = row.result_json?.political_lean || {};
    const fc = row.result_json?.fact_check || {};
    document.getElementById('history-drawer-content').innerHTML = `
      <h3 style="margin-bottom:8px">${escapeH(row.headline || 'Analysis')}</h3>
      <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-bottom:16px">${escapeH(row.url || '')}</p>
      <div class="result-summary">
        <div><strong>Lean:</strong> ${escapeH(lean.label || '—')} (${lean.numeric ?? '—'})</div>
        <div><strong>Fact score:</strong> ${fc.score ?? '—'}/100</div>
        <div><strong>Summary:</strong> ${escapeH(lean.summary || '—')}</div>
      </div>
    `;
    document.getElementById('history-drawer').hidden = false;
    document.getElementById('history-drawer').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    console.error('Failed to load analysis:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('history-load-more');
  if (btn) btn.addEventListener('click', loadHistory);
});
