/* ============================================================
   Veris — Media Bias Analyzer  |  script.js
   ============================================================ */

const API_BASE = "https://media-bias-analyzer-production.up.railway.app";

// ── Page routing ──────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page-section').forEach(s => {
    s.hidden = s.id !== `page-${name}`;
  });
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === name);
  });
  if (name !== 'results') window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const urlInput       = document.getElementById("url-input");
const textInput      = document.getElementById("text-input");
const analyzeBtn     = document.getElementById("analyze-btn");
const errorBanner    = document.getElementById("error-banner");
const errorText      = document.getElementById("error-text");
const resultsSection = document.getElementById("results");

// ── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove("hidden");
  resultsSection.classList.add("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorText.textContent = "";
}

const _LOADING_STAGES = [
  { delay: 0,    text: "Fetching article…" },
  { delay: 2500, text: "Reading the framing…" },
  { delay: 6000, text: "Checking facts…" },
  { delay: 9500, text: "Finding alternative perspectives…" },
  { delay: 13000, text: "Finalizing your analysis…" },
];
let _loadingTimers = [];

function _clearLoadingTimers() {
  _loadingTimers.forEach(clearTimeout);
  _loadingTimers = [];
}

function setLoading(on) {
  analyzeBtn.classList.toggle("loading", on);
  analyzeBtn.disabled = on;
  const label = analyzeBtn.querySelector(".btn-label");
  if (!label) return;
  _clearLoadingTimers();
  if (on) {
    const prefix = _activeMode === 'compare' ? "Comparing — " : "";
    _LOADING_STAGES.forEach(stage => {
      _loadingTimers.push(setTimeout(() => {
        label.textContent = prefix + stage.text;
      }, stage.delay));
    });
  } else {
    label.textContent = _activeMode === 'compare' ? "Compare Articles" : "Analyze Article";
  }
}

// ── Accordion ─────────────────────────────────────────────────────────────────
function initAccordions() {
  document.querySelectorAll(".accordion").forEach(acc => {
    const head = acc.querySelector(".acc-head");
    if (!head) return;
    head.addEventListener("click", () => toggleAccordion(acc));
    head.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion(acc); }
    });
  });
}

function toggleAccordion(acc) {
  const isOpen = acc.dataset.open === "true";
  const body    = acc.querySelector(".acc-body");
  const head    = acc.querySelector(".acc-head");
  const chevron = acc.querySelector(".acc-chevron");
  acc.dataset.open = isOpen ? "false" : "true";
  if (head) head.setAttribute("aria-expanded", String(!isOpen));
  if (body) body.classList.toggle("hidden", isOpen);
  if (chevron) chevron.classList.toggle("open", !isOpen);
}

function openAccordion(acc) {
  acc.dataset.open = "true";
  const head = acc.querySelector(".acc-head");
  const body = acc.querySelector(".acc-body");
  const chev = acc.querySelector(".acc-chevron");
  if (head) head.setAttribute("aria-expanded", "true");
  if (body) body.classList.remove("hidden");
  if (chev) chev.classList.add("open");
}

// ── Analyze ───────────────────────────────────────────────────────────────────
async function analyzeArticle() {
  clearError();
  const url  = urlInput.value.trim();
  const text = textInput.value.trim();

  if (!url && !text) {
    showError("Please enter a URL or paste article text before analyzing.");
    return;
  }

  setLoading(true);
  resultsSection.classList.add("hidden");

  try {
    const body = {};
    if (url)  body.url  = url;
    if (text) body.text = text;

    const token = typeof getToken === 'function' ? getToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 402) {
      showUpgradeModal();
      return;
    }
    if (res.status === 429) {
      const body429 = await res.json();
      if (body429.error === 'anon_limit') {
        showAnonLimitMessage();
      } else {
        showError('Too many requests. Please try again later.');
      }
      return;
    }

    const payload = await res.json();

    if (!res.ok || !payload.success) {
      showError(payload.detail || payload.error || "Analysis failed. Please try again.");
      return;
    }

    renderResults(payload);
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError(`Cannot reach the backend at ${API_BASE}. Check your network or try again.`);
    } else {
      showError("Unexpected error: " + err.message);
    }
  } finally {
    setLoading(false);
  }
}

// ── Render orchestrator ───────────────────────────────────────────────────────
function renderResults(payload) {
  const data = payload.data;
  if (!data) { showError("No analysis data returned."); return; }

  renderResultsHeader(data, payload.source_url);
  renderScoreCards(data);
  renderSummaryCard(data);
  renderPoliticalLean(data.political_lean);
  renderSentiment(data.sentiment);
  renderFactCheck(data.fact_check);
  renderBroadenSection(data.broaden_your_view);

  const savedEl = document.getElementById('saved-indicator');
  const loggedIn = typeof getSession === 'function' && getSession();
  if (savedEl) savedEl.hidden = !loggedIn;

  const hero = document.querySelector('.hero');
  if (hero) hero.style.display = 'none';
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Results header ────────────────────────────────────────────────────────────
function hostFromUrl(u) {
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

function renderResultsHeader(data, sourceUrl) {
  const source = data.source || {};
  const titleEl = document.getElementById('results-title');
  const metaEl  = document.getElementById('results-meta');
  const fallbackTitle = hostFromUrl(sourceUrl) || 'Pasted article';
  const displayTitle = data.title || source.headline || fallbackTitle;
  if (titleEl) {
    if (sourceUrl) {
      titleEl.innerHTML = `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="results-title-link">${escapeHtml(displayTitle)} <span class="ext-arrow">↗</span></a>`;
    } else {
      titleEl.textContent = displayTitle;
    }
  }
  if (metaEl) {
    const parts = [source.outlet, data.date, data.article_type].filter(Boolean);
    metaEl.innerHTML = parts.map((p, i) =>
      i < parts.length - 1
        ? `<span>${escapeHtml(p)}</span><span class="results-meta-dot"></span>`
        : `<span>${escapeHtml(p)}</span>`
    ).join('');
  }
}

// ── Score cards row ───────────────────────────────────────────────────────────
function renderScoreCards(data) {
  const pl = data.political_lean || {};
  const s  = data.sentiment      || {};
  const fc = data.fact_check     || {};

  const leanNum = typeof pl.numeric === 'number' ? pl.numeric : 0;
  const leanSign = leanNum >= 0 ? `+${leanNum.toFixed(1)}` : leanNum.toFixed(1);
  const leanVal  = document.getElementById('sc-lean-value');
  const leanSub  = document.getElementById('sc-lean-sub');
  if (leanVal) { leanVal.textContent = pl.label || '—'; leanVal.style.color = leanBadgeColor(pl.label); }
  if (leanSub) leanSub.textContent = pl.label
    ? `Score: ${leanSign} / 10 · ${pl.confidence || ''} confidence`
    : '';

  const sentNum = typeof s.numeric === 'number' ? s.numeric : 0;
  const sentVal = document.getElementById('sc-sent-value');
  const sentSub = document.getElementById('sc-sent-sub');
  if (sentVal) { sentVal.textContent = s.label || '—'; sentVal.style.color = sentBadgeColor(s.label); }
  if (sentSub) sentSub.textContent = s.label
    ? `Score: ${sentNum >= 0 ? '+' : ''}${sentNum} / 100`
    : '';

  const factVal = document.getElementById('sc-fact-value');
  const factSub = document.getElementById('sc-fact-sub');
  if (factVal) {
    factVal.innerHTML = fc.score != null
      ? `${fc.score}<span style="font-size:16px;font-weight:400;opacity:.5">/100</span>`
      : '—';
    factVal.style.color = factBadgeColor(fc.score);
  }
  if (factSub) {
    const supported = (fc.claims || []).filter(c => (c.verdict || '').toLowerCase() === 'supported').length;
    const disputed  = (fc.claims || []).filter(c => (c.verdict || '').toLowerCase() === 'disputed').length;
    factSub.textContent = fc.score != null ? `${supported} supported · ${disputed} disputed` : '';
  }
}

// ── Summary card ──────────────────────────────────────────────────────────────
function renderSummaryCard(data) {
  const typeTag = document.getElementById('article-type-tag');
  if (typeTag) {
    typeTag.textContent = data.article_type || '';
    typeTag.style.display = data.article_type ? 'inline-block' : 'none';
  }
  const prose = document.getElementById('summary-prose-text');
  if (prose) prose.textContent = data.summary || '';
}

// ── Political Lean accordion ──────────────────────────────────────────────────
function renderPoliticalLean(pl) {
  if (!pl) return;

  // Accordion badge
  const badge = document.getElementById("political-badge");
  badge.textContent = pl.label || "";
  badge.style.color = leanBadgeColor(pl.label);

  // Spectrum dot  →  map numeric -10…+10 to 0%…100%
  const numeric = typeof pl.numeric === "number" ? pl.numeric : (pl.score || 0) * 10;
  const pct = clamp(((numeric / 10 + 1) / 2) * 100, 2, 98);
  const spectrumDot = document.getElementById("spectrum-dot");
  if (spectrumDot) {
    spectrumDot.style.left = `calc(${pct}% - 9px)`;
    spectrumDot.style.background = leanBadgeColor(pl.label);
    spectrumDot.style.boxShadow = `0 2px 12px ${leanBadgeColor(pl.label)}80`;
  }

  // Confidence + explanation
  document.getElementById("political-conf").textContent =
    pl.confidence ? `Confidence: ${pl.confidence}` : "";
  document.getElementById("political-explanation").textContent = pl.explanation || "";

  // Framing choices
  const choices = pl.framing_choices || [];
  const framingSection = document.getElementById("framing-section");
  if (choices.length) {
    framingSection.classList.remove("hidden");
    document.getElementById("quote-list").innerHTML = choices.map(c => {
      const lean = (c.lean || "center").toLowerCase();
      return `
        <div class="quote-card lean-${escapeHtml(lean)}">
          <blockquote class="quote-text">"${escapeHtml(c.quote)}"</blockquote>
          <p class="quote-analysis">${escapeHtml(c.analysis)}</p>
        </div>
      `;
    }).join("");
  } else {
    framingSection.classList.add("hidden");
  }

  // Source selection
  const ss = pl.source_selection || {};
  const sourcesSection = document.getElementById("sources-section");
  if (ss.summary || (ss.sources && ss.sources.length)) {
    sourcesSection.classList.remove("hidden");
    document.getElementById("source-summary").textContent = ss.summary || "";
    document.getElementById("source-tags").innerHTML = (ss.sources || [])
      .map(s => `<span class="source-tag">${escapeHtml(s)}</span>`)
      .join("");
  } else {
    sourcesSection.classList.add("hidden");
  }

  // Notable omissions
  const omissions = pl.notable_omissions || [];
  const omissionsSection = document.getElementById("omissions-section");
  if (omissions.length) {
    omissionsSection.classList.remove("hidden");
    document.getElementById("omission-list").innerHTML = omissions
      .map(o => `<div class="omission-item">• ${escapeHtml(o)}</div>`)
      .join("");
  } else {
    omissionsSection.classList.add("hidden");
  }

  openAccordion(document.getElementById("acc-political"));
}

// ── Sentiment accordion ───────────────────────────────────────────────────────
function renderSentiment(s) {
  if (!s) return;

  const badge = document.getElementById("sentiment-badge");
  badge.textContent = s.label || "";
  badge.style.color = sentBadgeColor(s.label);

  // Gauge: numeric -100…+100 → reveal % of gradient (0% = all dark = very negative)
  const numeric = typeof s.numeric === "number" ? s.numeric : (s.score || 0) * 100;
  const leftPct = clamp(((numeric + 100) / 200) * 100, 0, 100);
  document.getElementById("gauge-fill").style.left = `${leftPct}%`;

  document.getElementById("sentiment-explanation").textContent = s.explanation || "";
}

// ── Fact Check accordion ──────────────────────────────────────────────────────
function renderFactCheck(fc) {
  if (!fc) return;

  const badge = document.getElementById("fact-badge");
  badge.textContent = fc.score != null ? `${fc.score}/100` : "";
  badge.style.color = factBadgeColor(fc.score);

  document.getElementById("fact-summary").textContent = fc.summary || "";

  const claims = fc.claims || [];
  document.getElementById("claim-list").innerHTML = claims.map(c => {
    const verdict = (c.verdict || "unverifiable").toLowerCase();
    return `
      <div class="claim-card ${escapeHtml(verdict)}">
        <span class="verdict-tag ${escapeHtml(verdict)}">${escapeHtml(c.verdict || "unverifiable")}</span>
        <p class="claim-text">${escapeHtml(c.claim)}</p>
        <p class="claim-explanation">${escapeHtml(c.explanation || "")}</p>
      </div>
    `;
  }).join("");

  openAccordion(document.getElementById("acc-fact"));
}

// ── Broaden Your View ─────────────────────────────────────────────────────────
function renderBroadenSection(items) {
  const section = document.getElementById("broaden-section");
  const grid    = document.getElementById("broaden-grid");
  if (!items || !items.length) { if (section) section.style.display = 'none'; return; }
  if (section) section.style.display = '';
  grid.innerHTML = items.map(item => {
    const perspective = (item.perspective || 'independent').toLowerCase();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(item.outlet + " " + item.angle)}`;
    return `
    <div class="broaden-card">
      <div class="broaden-top">
        <span class="broaden-outlet">${escapeHtml(item.outlet)}</span>
        <span class="perspective-tag ${escapeHtml(perspective)}">${escapeHtml(item.perspective || '')}</span>
      </div>
      <p class="broaden-angle">${escapeHtml(item.angle)}</p>
      <p class="broaden-why">${escapeHtml(item.why)}</p>
      <a class="broaden-link" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Search on Google →</a>
    </div>
  `}).join('');
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function leanBadgeColor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("left"))  return "var(--cyan)";
  if (l.includes("right")) return "#ef4444";
  return "var(--muted)";
}

function sentBadgeColor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("positive")) return "var(--green)";
  if (l.includes("negative")) return "#ef4444";
  return "var(--muted)";
}

function factBadgeColor(score) {
  if (score == null) return "var(--muted)";
  if (score >= 75) return "var(--green)";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

// ── Tab switching (Single / Compare) ──────────────────────────────────────────
const compareResults = document.getElementById("compare-results");
let _activeMode = 'single';

function setTab(mode) {
  _activeMode = mode;
  const isSingle = mode === 'single';
  const tabSingleEl  = document.getElementById('tab-single');
  const tabCompareEl = document.getElementById('tab-compare');
  const singleEl  = document.getElementById('single-inputs');
  const compareEl = document.getElementById('compare-inputs');
  if (tabSingleEl)  tabSingleEl.classList.toggle('active', isSingle);
  if (tabCompareEl) tabCompareEl.classList.toggle('active', !isSingle);
  if (singleEl)  singleEl.classList.toggle('hidden', !isSingle);
  if (compareEl) compareEl.classList.toggle('hidden', isSingle);
  const label = analyzeBtn.querySelector('.btn-label');
  if (label) label.textContent = isSingle ? 'Analyze Article' : 'Compare Articles';
  if (compareResults) compareResults.classList.add('hidden');
  resultsSection.classList.add('hidden');
  clearError();
}

document.addEventListener('DOMContentLoaded', () => {
  const tabSingleEl  = document.getElementById('tab-single');
  const tabCompareEl = document.getElementById('tab-compare');
  if (tabSingleEl)  tabSingleEl.addEventListener('click',  () => setTab('single'));
  if (tabCompareEl) tabCompareEl.addEventListener('click', () => setTab('compare'));
});

// ── Compare ───────────────────────────────────────────────────────────────────
function setCompareLoading(on) {
  setLoading(on);
}

async function compareArticles() {
  clearError();
  const url1   = document.getElementById("url-input-1").value.trim();
  const text1  = document.getElementById("text-input-1").value.trim();
  const url2   = document.getElementById("url-input-2").value.trim();
  const text2  = document.getElementById("text-input-2").value.trim();
  const label1 = document.getElementById("source-name-1").value.trim() || "Article A";
  const label2 = document.getElementById("source-name-2").value.trim() || "Article B";

  if (!url1 && !text1) { showError("Article A: please enter a URL or paste article text."); return; }
  if (!url2 && !text2) { showError("Article B: please enter a URL or paste article text."); return; }

  setCompareLoading(true);
  compareResults.classList.add("hidden");

  try {
    const token = typeof getToken === 'function' ? getToken() : null;
    const compareHeaders = { 'Content-Type': 'application/json' };
    if (token) compareHeaders['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/compare`, {
      method: 'POST',
      headers: compareHeaders,
      body: JSON.stringify({
        article1: { url: url1 || null, text: text1 || null },
        article2: { url: url2 || null, text: text2 || null },
      }),
    });

    if (res.status === 402) { showUpgradeModal(); return; }
    if (res.status === 429) {
      const b = await res.json();
      showError(b.error === 'anon_limit' ? 'Sign up free for 3 analyses/month.' : 'Too many requests. Try again later.');
      return;
    }

    const payload = await res.json();

    if (!res.ok) {
      showError(payload.detail || payload.error || `Server error (${res.status})`);
      return;
    }
    if (!payload.article1.success) { showError("Article 1: " + payload.article1.error); return; }
    if (!payload.article2.success) { showError("Article 2: " + payload.article2.error); return; }

    renderCompareResults(payload.article1.data, payload.article2.data, label1, label2);
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError(`Cannot reach the backend at ${API_BASE}. Check your network or try again.`);
    } else {
      showError("Unexpected error: " + err.message);
    }
  } finally {
    setCompareLoading(false);
  }
}

// ── Compare render ────────────────────────────────────────────────────────────
function renderCompareResults(d1, d2, label1 = "Article A", label2 = "Article B") {
  const cols = document.getElementById("compare-columns");
  cols.innerHTML = buildCompareCol(d1, "1", label1) + buildCompareCol(d2, "2", label2);

  // Wire accordion toggles for the newly injected HTML
  cols.querySelectorAll(".accordion").forEach(acc => {
    const head = acc.querySelector(".acc-head");
    if (!head) return;
    head.addEventListener("click", () => toggleAccordion(acc));
    head.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion(acc); }
    });
  });

  compareResults.classList.remove("hidden");
  compareResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildCompareCol(data, n, label) {
  const pl = data.political_lean || {};
  const s  = data.sentiment      || {};
  const fc = data.fact_check     || {};

  const numeric  = typeof pl.numeric === "number" ? pl.numeric : 0;
  const pct      = clamp(((numeric / 10 + 1) / 2) * 100, 2, 98);
  const sentNum  = typeof s.numeric === "number" ? s.numeric : 0;
  const gaugePct = clamp(((sentNum + 100) / 200) * 100, 0, 100);

  const claims = (fc.claims || []).map(c => {
    const v = (c.verdict || "unverifiable").toLowerCase();
    return `
      <div class="claim-card ${escapeHtml(v)}">
        <span class="verdict-tag ${escapeHtml(v)}">${escapeHtml(c.verdict || "unverifiable")}</span>
        <p class="claim-text">${escapeHtml(c.claim)}</p>
        <p class="claim-explanation">${escapeHtml(c.explanation || "")}</p>
      </div>`;
  }).join("");

  const typeTag = data.article_type
    ? `<span class="article-type-tag">${escapeHtml(data.article_type)}</span>` : "";

  return `
    <div class="compare-col">
      <div class="compare-col-header">
        <span class="col-num">${n === "1" ? "A" : "B"}</span>
        ${escapeHtml(label)}
      </div>

      <!-- summary -->
      <div class="summary-prose">
        <div class="summary-prose-label">Summary</div>
        <p class="summary-prose-text">${escapeHtml(data.summary || "")}</p>
        ${typeTag ? `<span class="article-type-tag">${escapeHtml(data.article_type || "")}</span>` : ""}
      </div>

      <!-- political lean -->
      <div class="accordion" data-open="true">
        <div class="acc-head" role="button" tabindex="0" aria-expanded="true">
          <div class="acc-title-row">
            <span class="acc-title">Political Lean</span>
            <span class="acc-badge-pill" style="color:${leanBadgeColor(pl.label)}">${escapeHtml(pl.label || "")}</span>
          </div>
          <span class="acc-chevron open">▾</span>
        </div>
        <div class="acc-body">
          <div class="spectrum-wrap">
            <div style="position:relative;margin-bottom:8px">
              <div class="spectrum-track"></div>
              <div class="spectrum-dot" style="left:calc(${pct}% - 9px);background:${leanBadgeColor(pl.label)};box-shadow:0 2px 12px ${leanBadgeColor(pl.label)}80"></div>
            </div>
            <div class="spectrum-labels"><span>Left</span><span>Center</span><span>Right</span></div>
          </div>
          <p class="conf-line">${pl.confidence ? "Confidence: " + escapeHtml(pl.confidence) : ""}</p>
          <p class="body-text">${escapeHtml(pl.explanation || "")}</p>
        </div>
      </div>

      <!-- sentiment -->
      <div class="accordion" data-open="true">
        <div class="acc-head" role="button" tabindex="0" aria-expanded="true">
          <div class="acc-title-row">
            <span class="acc-title">Sentiment</span>
            <span class="acc-badge-pill" style="color:${sentBadgeColor(s.label)}">${escapeHtml(s.label || "")}</span>
          </div>
          <span class="acc-chevron open">▾</span>
        </div>
        <div class="acc-body">
          <div>
            <div class="gauge-track">
              <div class="gauge-cover" style="left:${gaugePct}%"></div>
            </div>
            <div class="gauge-labels"><span>Very Negative</span><span>Neutral</span><span>Very Positive</span></div>
          </div>
          <p class="body-text">${escapeHtml(s.explanation || "")}</p>
        </div>
      </div>

      <!-- fact check -->
      <div class="accordion" data-open="true">
        <div class="acc-head" role="button" tabindex="0" aria-expanded="true">
          <div class="acc-title-row">
            <span class="acc-title">Fact Check</span>
            <span class="acc-badge-pill" style="color:${factBadgeColor(fc.score)}">${fc.score != null ? fc.score + "/100" : ""}</span>
          </div>
          <span class="acc-chevron open">▾</span>
        </div>
        <div class="acc-body">
          <p class="body-text">${escapeHtml(fc.summary || "")}</p>
          <div class="claim-list">${claims}</div>
        </div>
      </div>
    </div>
  `;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function startCheckout() {
  const token = typeof getToken === 'function' ? getToken() : null;
  if (!token) { if (typeof signInWithGoogle === 'function') signInWithGoogle(); return; }
  try {
    const r = await fetch(`${API_BASE}/stripe/checkout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('Checkout error:', r.status, err);
      if (typeof showToast === 'function') showToast(`Checkout failed (${r.status}). Stripe may not be configured.`, 'error');
      return;
    }
    const { url } = await r.json();
    if (!url) {
      if (typeof showToast === 'function') showToast('Checkout returned no URL.', 'error');
      return;
    }
    window.location.href = url;
  } catch (e) {
    console.error('Checkout exception:', e);
    if (typeof showToast === 'function') showToast('Could not start checkout. Please try again.', 'error');
  }
}

function showUpgradeModal() {
  document.getElementById('upgrade-modal').hidden = false;
  document.getElementById('upgrade-btn').onclick = startCheckout;
}

function showAnonLimitMessage() {
  errorText.innerHTML = `You've used your free try. <button onclick="if(typeof signInWithGoogle==='function')signInWithGoogle()" style="color:var(--cyan);background:none;border:none;cursor:pointer;font-size:inherit;text-decoration:underline">Sign up free</button> for 3 analyses/month.`;
  errorBanner.classList.remove('hidden');
  resultsSection.classList.add('hidden');
}

function showAccountSettings() {
  if (typeof showPage === 'function') showPage('account');
  loadAccountUsage();
}

// ── Account page ──────────────────────────────────────────────────────────────
function initAccountPage() {
  document.querySelectorAll('.side-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sec = item.dataset.accsec;
      document.querySelectorAll('.side-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.account-section').forEach(s => s.classList.add('hidden'));
      const target = document.getElementById(`accsec-${sec}`);
      if (target) target.classList.remove('hidden');
    });
  });

  const signoutBtn = document.getElementById('account-signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', () => {
    if (typeof authSignOut === 'function') authSignOut();
  });

  const deleteBtn = document.getElementById('delete-account-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', confirmDeleteAccount);

  const upgradeBtn = document.getElementById('account-upgrade-btn');
  if (upgradeBtn) upgradeBtn.addEventListener('click', startCheckout);
}

async function loadAccountUsage() {
  const session = typeof getSession === 'function' ? getSession() : null;
  if (!session) return;

  const email   = session.user.email;
  const initial = email[0].toUpperCase();
  const nameParts = email.split('@')[0].replace(/[._]/g, ' ');

  const avatarEl = document.getElementById('profile-avatar');
  const nameEl   = document.getElementById('profile-name');
  const emailEl  = document.getElementById('profile-email');
  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl)   nameEl.textContent   = nameParts;
  if (emailEl)  emailEl.textContent  = email;

  try {
    const token = typeof getToken === 'function' ? getToken() : null;
    if (!token) return;
    const res = await fetch(`${API_BASE}/auth/usage`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const { analyses_this_month, limit, tier } = await res.json();

    const statAnalyses = document.getElementById('stat-analyses');
    if (statAnalyses) statAnalyses.textContent = analyses_this_month ?? '—';
    loadAccountSourcesAndCounts();

    const pct = limit > 0 ? Math.min(100, ((analyses_this_month || 0) / limit) * 100) : 0;
    const fill = document.getElementById('usage-bar-fill');
    const count = document.getElementById('usage-bar-count');
    if (fill)  fill.style.width   = `${pct.toFixed(1)}%`;
    if (count) count.textContent  = `${analyses_this_month ?? 0} / ${limit ?? '—'}`;

    const isPaid = tier === 'paid';
    const planBadge = document.getElementById('plan-badge');
    const planTitle = document.getElementById('plan-info-title');
    const planDesc  = document.getElementById('plan-info-desc');
    const upgradeBtn = document.getElementById('account-upgrade-btn');
    if (planBadge) planBadge.textContent = isPaid ? '✦ Pro Plan' : 'Free Plan';
    if (planTitle) planTitle.textContent = isPaid ? '✦ Pro Plan — $7.99/month' : 'Free Plan';
    if (planDesc)  planDesc.textContent  = isPaid
      ? '30 analyses per month. Thank you for supporting Veris!'
      : '3 analyses per month. Upgrade for 30 analyses/month.';
    if (upgradeBtn) upgradeBtn.style.display = isPaid ? 'none' : '';
  } catch (e) {
    console.error('Failed to load usage:', e);
  }
}

async function loadAccountSourcesAndCounts() {
  const token = typeof getToken === 'function' ? getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/auth/history?offset=0&limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const { items } = await res.json();
    const list = items || [];

    const savedEl = document.getElementById('stat-saved');
    if (savedEl) savedEl.textContent = list.length;

    // Comparisons aren't tracked separately yet
    const cmpEl = document.getElementById('stat-comparisons');
    if (cmpEl) cmpEl.textContent = '—';

    // Aggregate by source_name
    const counts = {};
    const leans = {};
    list.forEach(item => {
      const src = (item.source_name || '').trim();
      if (!src) return;
      counts[src] = (counts[src] || 0) + 1;
      if (item.lean_label) {
        if (!leans[src]) leans[src] = {};
        leans[src][item.lean_label] = (leans[src][item.lean_label] || 0) + 1;
      }
    });
    const top = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);

    const wrap = document.getElementById('top-sources-list');
    if (!wrap) return;
    if (!top.length) {
      wrap.innerHTML = '<div class="empty-text" style="padding:20px 0">Analyze a few articles to see your top sources.</div>';
      return;
    }
    wrap.innerHTML = top.map(([src, count]) => {
      const dom = leans[src]
        ? Object.entries(leans[src]).sort((a,b) => b[1] - a[1])[0][0]
        : null;
      const cls = leanBadgeClassFor(dom);
      const badge = dom ? `<span class="${cls}">${escapeHtml(dom)}</span>` : '';
      return `
        <div class="source-row">
          <div>
            <div class="source-row-name">${escapeHtml(src)}</div>
            <div class="source-row-count">${count} analys${count === 1 ? 'is' : 'es'}</div>
          </div>
          <div>${badge}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Failed to load top sources:', e);
  }
}

function leanBadgeClassFor(lean) {
  if (!lean) return 'h-badge h-badge-center';
  const l = lean.toLowerCase();
  if (l.includes('left'))  return 'h-badge h-badge-left';
  if (l.includes('right')) return 'h-badge h-badge-right';
  return 'h-badge h-badge-center';
}

async function confirmDeleteAccount() {
  if (!confirm('This will permanently delete your account and all saved analyses. This cannot be undone.')) return;
  const token = typeof getToken === 'function' ? getToken() : null;
  if (!token) return;
  try {
    await fetch(`${API_BASE}/auth/account`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (typeof authSignOut === 'function') await authSignOut();
    if (typeof showToast === 'function') showToast('Your account has been deleted.', 'info');
  } catch {
    showError('Could not delete account. Please try again.');
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
urlInput.addEventListener("keydown",  e => { if (e.key === "Enter") analyzeArticle(); });
textInput.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyzeArticle(); });
analyzeBtn.addEventListener("click", () => {
  if (_activeMode === 'compare') {
    compareArticles();
  } else {
    analyzeArticle();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
initAccordions();

document.addEventListener('DOMContentLoaded', () => {
  // ── Nav link routing ──
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page === 'history') {
        const session = typeof getSession === 'function' ? getSession() : null;
        if (!session) { if (typeof signInWithGoogle === 'function') signInWithGoogle(); return; }
        showPage('history');
        if (typeof loadHistory === 'function') {
          const list = document.getElementById('history-list');
          if (list) list.innerHTML = '';
          if (typeof _historyOffset !== 'undefined') _historyOffset = 0;
          loadHistory();
        }
        return;
      }
      if (page === 'account') {
        const session = typeof getSession === 'function' ? getSession() : null;
        if (!session) { if (typeof signInWithGoogle === 'function') signInWithGoogle(); return; }
        showPage('account');
        loadAccountUsage();
        return;
      }
      if (page === 'home') {
        resultsSection.classList.add('hidden');
        const cmp = document.getElementById('compare-results');
        if (cmp) cmp.classList.add('hidden');
        const hero = document.querySelector('.hero');
        if (hero) hero.style.display = '';
        clearError();
      }
      showPage(page);
    });
  });

  initAccountPage();

  const logoLink = document.getElementById('nav-logo-link');
  if (logoLink) logoLink.addEventListener('click', e => {
    e.preventDefault();
    resultsSection.classList.add('hidden');
    const cmp = document.getElementById('compare-results');
    if (cmp) cmp.classList.add('hidden');
    const hero = document.querySelector('.hero');
    if (hero) hero.style.display = '';
    clearError();
    showPage('home');
  });

  const backBtn = document.getElementById('results-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      resultsSection.classList.add('hidden');
      const cmp = document.getElementById('compare-results');
      if (cmp) cmp.classList.add('hidden');
      const hero = document.querySelector('.hero');
      if (hero) hero.style.display = '';
      clearError();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
});

// ── ?url=<encoded> auto-analyze ──────────────────────────────────────────────
// The Chrome extension links here as "Open full report on veris.news".
// On load, if a ?url= param is present, fill the input and run analyze.
document.addEventListener('DOMContentLoaded', () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromExt = params.get('url');
    if (!fromExt) return;
    if (urlInput) urlInput.value = fromExt;
    // Defer one tick so other DOMContentLoaded handlers (auth, history) run first.
    setTimeout(() => analyzeArticle(), 0);
  } catch (err) {
    console.warn('[veris] ?url= autofill failed:', err);
  }
});
