const API_BASE_H = typeof API_BASE !== 'undefined' ? API_BASE : 'https://media-bias-analyzer-production.up.railway.app';

let _historyOffset = 0;
const _PAGE_SIZE = 20;

function showHistoryView() {
  if (typeof showPage === 'function') showPage('history');
  _historyOffset = 0;
  const list = document.getElementById('history-list');
  if (list) list.innerHTML = '';
  loadHistory();
}

function hideHistoryView() {
  if (typeof showPage === 'function') showPage('home');
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
    renderCards(items || []);
    _historyOffset += (items || []).length;
    const btn = document.getElementById('history-load-more');
    if (btn) btn.hidden = (items || []).length < _PAGE_SIZE;
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

function escapeH(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function leanBadgeClass(lean) {
  if (!lean) return 'h-badge h-badge-center';
  const l = lean.toLowerCase();
  if (l.includes('left'))  return 'h-badge h-badge-left';
  if (l.includes('right')) return 'h-badge h-badge-right';
  return 'h-badge h-badge-center';
}

function renderCards(items) {
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!items.length && _historyOffset === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No analyses yet. Analyze an article to get started.</div></div>';
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  function dateLabel(item) {
    const d = new Date(item.created_at); d.setHours(0,0,0,0);
    if (d.getTime() >= today.getTime()) return 'Today';
    if (d.getTime() >= yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const grouped = {};
  const groupOrder = [];
  items.forEach(item => {
    const label = dateLabel(item);
    if (!grouped[label]) { grouped[label] = []; groupOrder.push(label); }
    grouped[label].push(item);
  });

  groupOrder.forEach(label => {
    const groupDiv = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'history-group-label';
    labelEl.textContent = label;
    groupDiv.appendChild(labelEl);

    grouped[label].forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'history-item';
      itemEl.dataset.id = item.id;
      const factScorePill = item.fact_score != null
        ? `<span class="h-badge h-badge-score">${item.fact_score}/100</span>`
        : '';
      const leanPill = item.lean_label
        ? `<span class="${escapeH(leanBadgeClass(item.lean_label))}">${escapeH(item.lean_label)}</span>`
        : '';
      const timeStr = new Date(item.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      itemEl.innerHTML = `
        <div class="history-icon" style="background:rgba(34,211,238,0.12)">⊙</div>
        <div class="history-body">
          <div class="history-title">${escapeH(item.headline || item.url || 'Untitled')}</div>
          <div class="history-meta">
            <span>${escapeH(item.source_name || 'Unknown')}</span>
            <span>·</span>
            <span>${timeStr}</span>
          </div>
        </div>
        <div class="history-badges">${leanPill}${factScorePill}</div>
      `;
      itemEl.addEventListener('click', () => {
        console.log('Open analysis:', item.id);
      });
      groupDiv.appendChild(itemEl);
    });
    list.appendChild(groupDiv);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('history-load-more');
  if (btn) btn.addEventListener('click', loadHistory);

  const searchInput = document.getElementById('history-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.history-item').forEach(el => {
        const title  = el.querySelector('.history-title')?.textContent.toLowerCase() || '';
        const source = el.querySelector('.history-meta span')?.textContent.toLowerCase() || '';
        el.style.display = (!q || title.includes(q) || source.includes(q)) ? '' : 'none';
      });
    });
  }
});
