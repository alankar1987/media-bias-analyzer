/* ============================================================
   Veris — Media Bias Analyzer  |  script.js
   ============================================================ */

const API_BASE = "https://media-bias-analyzer-production.up.railway.app";

// ── State ─────────────────────────────────────────────────────────────────────
let lastAnalyzedUrl     = "";
let lastAnalyzedPayload = null;

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

function titleCase(str) {
  if (!str) return str;
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove("hidden");
  resultsSection.classList.add("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorText.textContent = "";
}

function setLoading(on) {
  analyzeBtn.classList.toggle("loading", on);
  analyzeBtn.disabled = on;
  analyzeBtn.querySelector(".btn-label").textContent = on ? "Analyzing…" : "Analyze Article";
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigateTo(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const page = document.getElementById("page-" + pageId);
  if (page) page.classList.remove("hidden");
  const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (link) link.classList.add("active");

  if (pageId === "history") renderHistoryPage();
  if (pageId === "account") renderAccountPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(btn => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.page));
});

// ── Accordion ─────────────────────────────────────────────────────────────────
function initAccordions() {
  document.querySelectorAll(".accordion").forEach(acc => {
    const header = acc.querySelector(".accordion-header");
    header.addEventListener("click", () => toggleAccordion(acc));
    header.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion(acc); }
    });
  });
}

function toggleAccordion(acc) {
  const isOpen = acc.dataset.open === "true";
  const body   = acc.querySelector(".accordion-body");
  const header = acc.querySelector(".accordion-header");
  acc.dataset.open = isOpen ? "false" : "true";
  header.setAttribute("aria-expanded", String(!isOpen));
  body.classList.toggle("hidden", isOpen);
}

function openAccordion(acc) {
  acc.dataset.open = "true";
  acc.querySelector(".accordion-header").setAttribute("aria-expanded", "true");
  acc.querySelector(".accordion-body").classList.remove("hidden");
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

  lastAnalyzedUrl = url;
  setLoading(true);
  resultsSection.classList.add("hidden");

  try {
    const body = {};
    if (url)  body.url  = url;
    if (text) body.text = text;

    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await res.json();

    if (!res.ok || !payload.success) {
      showError(payload.detail || payload.error || "Analysis failed. Please try again.");
      return;
    }

    lastAnalyzedPayload = payload;
    renderResults(payload);
    saveToHistory(payload.data, url, "single");
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError("Cannot reach the backend. Make sure the FastAPI server is running.");
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

  renderResultsHeader(data, lastAnalyzedUrl);
  renderScoreCards(data);
  renderSummaryBlock(data);
  renderPoliticalLean(data.political_lean);
  renderSentiment(data.sentiment);
  renderFactCheck(data.fact_check);
  renderBroadenSection(data.broaden_your_view);

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) {
    saveBtn.classList.remove("saved");
    saveBtn.textContent = "Save to History ✓";
  }

  document.querySelector(".hero").classList.add("hidden");
  resultsSection.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Results header ────────────────────────────────────────────────────────────
function renderResultsHeader(data, url) {
  let source = "Unknown source";
  if (url) {
    try { source = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
  }
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const articleType = data.article_type || "";

  const titleEl = document.getElementById("results-title");
  const metaEl  = document.getElementById("results-meta");
  if (titleEl) titleEl.textContent = url ? source + " article" : "Article Analysis";

  if (metaEl) {
    const parts = [escapeHtml(source), escapeHtml(date)];
    if (articleType) parts.push(escapeHtml(articleType));
    metaEl.innerHTML = parts
      .map(p => `<span>${p}</span>`)
      .join('<span class="meta-dot">·</span>');
  }
}

// ── Score cards ───────────────────────────────────────────────────────────────
function renderScoreCards(data) {
  const pl = data.political_lean || {};
  const s  = data.sentiment      || {};
  const fc = data.fact_check     || {};

  const leanNum  = typeof pl.numeric === "number" ? pl.numeric : 0;
  const sentNum  = typeof s.numeric  === "number" ? s.numeric  : 0;
  const leanSign = leanNum >= 0 ? `+${leanNum.toFixed(1)}` : leanNum.toFixed(1);
  const sentSign = sentNum >= 0 ? `+${Math.round(sentNum)}` : String(Math.round(sentNum));

  const leanColor = leanNum < -1 ? "#22d3ee" : leanNum > 1 ? "#ef4444" : "rgba(240,244,248,0.50)";
  const sentColor = sentNum > 20  ? "#10b981" : sentNum < -20 ? "#ef4444" : "rgba(240,244,248,0.50)";
  const factScore = fc.score != null ? fc.score : null;
  const factColor = factScore === null ? "rgba(240,244,248,0.50)"
                  : factScore >= 80   ? "#10b981"
                  : factScore >= 60   ? "#f59e0b"
                  : "#ef4444";
  const factReliability = factScore === null ? "No data"
                        : factScore >= 80    ? "High reliability"
                        : factScore >= 60    ? "Moderate reliability"
                        : "Low reliability";

  const row = document.getElementById("score-cards-row");
  if (!row) return;
  row.innerHTML = `
    <div class="score-card">
      <div class="score-card-label">Political Lean</div>
      <div class="score-card-value" style="color:${leanColor}">${escapeHtml(titleCase(pl.label) || "—")}</div>
      <div class="score-card-sub">Score: ${leanSign} / 10 · ${escapeHtml(titleCase(pl.confidence) || "N/A")}</div>
    </div>
    <div class="score-card">
      <div class="score-card-label">Sentiment</div>
      <div class="score-card-value" style="color:${sentColor}">${escapeHtml(titleCase(s.label) || "—")}</div>
      <div class="score-card-sub">Score: ${sentSign} / 100</div>
    </div>
    <div class="score-card">
      <div class="score-card-label">Fact Check</div>
      <div class="score-card-value" style="color:${factColor}">${factScore !== null ? factScore + "/100" : "—"}</div>
      <div class="score-card-sub">${factReliability}</div>
    </div>
  `;
}

// ── Summary block ─────────────────────────────────────────────────────────────
function renderSummaryBlock(data) {
  const block = document.getElementById("summary-block");
  if (!block) return;
  const typeTag = data.article_type
    ? `<span class="article-type-tag">${escapeHtml(data.article_type)}</span>`
    : "";
  block.innerHTML = `
    <div class="summary-prose-label">Analysis Summary</div>
    <p class="summary-prose-text">${escapeHtml(data.summary || "")}</p>
    ${typeTag}
  `;
}

// ── Political Lean accordion ──────────────────────────────────────────────────
function renderPoliticalLean(pl) {
  if (!pl) return;

  const badge = document.getElementById("political-badge");
  badge.textContent = titleCase(pl.label) || "";
  badge.style.color = leanBadgeColor(pl.label);

  const numeric = typeof pl.numeric === "number" ? pl.numeric : (pl.score || 0) * 10;
  const pct = clamp(((numeric / 10 + 1) / 2) * 100, 2, 98);
  const dot = document.getElementById("spectrum-dot");
  dot.style.left = `calc(${pct}% - 9px)`;
  dot.style.background = leanBadgeColor(pl.label);

  document.getElementById("political-conf").textContent =
    pl.confidence ? `Confidence: ${titleCase(pl.confidence)}` : "";
  document.getElementById("political-explanation").textContent = pl.explanation || "";

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
        </div>`;
    }).join("");
  } else {
    framingSection.classList.add("hidden");
  }

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
  badge.textContent = titleCase(s.label) || "";
  badge.style.color = sentBadgeColor(s.label);

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
      </div>`;
  }).join("");

  openAccordion(document.getElementById("acc-fact"));
}

// ── Broaden Your View ─────────────────────────────────────────────────────────
function renderBroadenSection(items) {
  const section = document.getElementById("broaden-section");
  const grid    = document.getElementById("broaden-grid");

  if (!items || !items.length) { section.classList.add("hidden"); return; }

  section.classList.remove("hidden");
  grid.innerHTML = items.map(item => {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(item.outlet + " " + item.angle)}`;
    return `
      <div class="broaden-card">
        <div class="broaden-card-top">
          <span class="broaden-outlet">${escapeHtml(item.outlet)}</span>
          <span class="perspective-tag ${escapeHtml((item.perspective || "").toLowerCase())}">
            ${escapeHtml(item.perspective || "")}
          </span>
        </div>
        <p class="broaden-angle">${escapeHtml(item.angle)}</p>
        <p class="broaden-why">${escapeHtml(item.why)}</p>
        <a class="broaden-link" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Search on Google →</a>
      </div>`;
  }).join("");
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function leanBadgeColor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("left"))  return "#22d3ee";
  if (l.includes("right")) return "#ef4444";
  return "rgba(240,244,248,0.50)";
}
function sentBadgeColor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("positive")) return "#10b981";
  if (l.includes("negative")) return "#ef4444";
  return "rgba(240,244,248,0.50)";
}
function factBadgeColor(score) {
  if (score == null) return "rgba(240,244,248,0.50)";
  if (score >= 80)   return "#10b981";
  if (score >= 60)   return "#f59e0b";
  return "#ef4444";
}

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById("back-btn").addEventListener("click", () => {
  resultsSection.classList.add("hidden");
  document.querySelector(".hero").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

const compareBackBtn = document.getElementById("compare-back-btn");
if (compareBackBtn) {
  compareBackBtn.addEventListener("click", () => {
    document.getElementById("compare-results").classList.add("hidden");
    document.querySelector(".hero").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ── Save to History button ────────────────────────────────────────────────────
document.getElementById("save-btn").addEventListener("click", () => {
  if (lastAnalyzedPayload) {
    saveToHistory(lastAnalyzedPayload.data, lastAnalyzedUrl, "single");
    const btn = document.getElementById("save-btn");
    btn.textContent = "Saved ✓";
    btn.classList.add("saved");
  }
});

// ── Mode toggle ───────────────────────────────────────────────────────────────
const singleInputCard  = document.getElementById("single-input-card");
const compareInputCard = document.getElementById("compare-input-card");
const compareResults   = document.getElementById("compare-results");

document.getElementById("mode-single").addEventListener("click", function () {
  this.classList.add("active");
  document.getElementById("mode-compare").classList.remove("active");
  singleInputCard.classList.remove("hidden");
  compareInputCard.classList.add("hidden");
  compareResults.classList.add("hidden");
  clearError();
});

document.getElementById("mode-compare").addEventListener("click", function () {
  this.classList.add("active");
  document.getElementById("mode-single").classList.remove("active");
  compareInputCard.classList.remove("hidden");
  singleInputCard.classList.add("hidden");
  resultsSection.classList.add("hidden");
  clearError();
});

// ── Compare ───────────────────────────────────────────────────────────────────
const compareBtn = document.getElementById("compare-btn");

function setCompareLoading(on) {
  compareBtn.classList.toggle("loading", on);
  compareBtn.disabled = on;
  compareBtn.querySelector(".btn-label").textContent = on ? "Comparing…" : "Compare Articles";
}

async function compareArticles() {
  clearError();
  const url1  = document.getElementById("url-input-1").value.trim();
  const text1 = document.getElementById("text-input-1").value.trim();
  const url2  = document.getElementById("url-input-2").value.trim();
  const text2 = document.getElementById("text-input-2").value.trim();

  if (!url1 && !text1) { showError("Article A: please enter a URL or paste article text."); return; }
  if (!url2 && !text2) { showError("Article B: please enter a URL or paste article text."); return; }

  setCompareLoading(true);
  compareResults.classList.add("hidden");

  try {
    const res = await fetch(`${API_BASE}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        article1: { url: url1 || null, text: text1 || null },
        article2: { url: url2 || null, text: text2 || null },
      }),
    });

    const payload = await res.json();

    if (!res.ok) {
      showError(payload.detail || payload.error || `Server error (${res.status})`);
      return;
    }
    if (!payload.article1.success) { showError("Article 1: " + payload.article1.error); return; }
    if (!payload.article2.success) { showError("Article 2: " + payload.article2.error); return; }

    renderCompareResults(payload.article1.data, payload.article2.data, "Article A", "Article B");
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError("Cannot reach the backend. Make sure the FastAPI server is running.");
    } else {
      showError("Unexpected error: " + err.message);
    }
  } finally {
    setCompareLoading(false);
  }
}

compareBtn.addEventListener("click", compareArticles);

// ── Compare render ────────────────────────────────────────────────────────────
function renderCompareResults(d1, d2, label1 = "Article A", label2 = "Article B") {
  const cols = document.getElementById("compare-columns");
  cols.innerHTML = buildCompareCol(d1, "1", label1) + buildCompareCol(d2, "2", label2);

  cols.querySelectorAll(".accordion").forEach(acc => {
    const header = acc.querySelector(".accordion-header");
    header.addEventListener("click", () => toggleAccordion(acc));
    header.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion(acc); }
    });
  });

  document.querySelector(".hero").classList.add("hidden");
  compareResults.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function buildCompareCol(data, n, label) {
  const pl = data.political_lean || {};
  const s  = data.sentiment      || {};
  const fc = data.fact_check     || {};

  const numeric  = typeof pl.numeric === "number" ? pl.numeric : 0;
  const pct      = clamp(((numeric / 10 + 1) / 2) * 100, 2, 98);
  const sentNum  = typeof s.numeric === "number" ? s.numeric : 0;
  const gaugePct = clamp(((sentNum + 100) / 200) * 100, 0, 100);
  const dotBg    = leanBadgeColor(pl.label);

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

      <div class="summary-prose-card">
        <div class="summary-prose-label">Summary</div>
        ${typeTag}
        <p class="summary-prose-text">${escapeHtml(data.summary || "")}</p>
      </div>

      <div class="accordion glass-card-sm" data-open="true">
        <div class="accordion-header" role="button" tabindex="0" aria-expanded="true">
          <div class="accordion-title-row">
            <span class="accordion-title">Political Lean</span>
            <span class="acc-badge" style="color:${leanBadgeColor(pl.label)}">${escapeHtml(pl.label || "")}</span>
          </div>
          <span class="chevron">▾</span>
        </div>
        <div class="accordion-body">
          <div class="spectrum-wrap">
            <div class="spectrum-bar">
              <div class="spectrum-track"></div>
              <div class="spectrum-dot" style="left:calc(${pct}% - 9px);background:${dotBg}"></div>
            </div>
            <div class="spectrum-labels"><span>Left</span><span>Center</span><span>Right</span></div>
          </div>
          <p class="conf-line">${pl.confidence ? "Confidence: " + escapeHtml(pl.confidence) : ""}</p>
          <p class="body-text">${escapeHtml(pl.explanation || "")}</p>
        </div>
      </div>

      <div class="accordion glass-card-sm" data-open="true">
        <div class="accordion-header" role="button" tabindex="0" aria-expanded="true">
          <div class="accordion-title-row">
            <span class="accordion-title">Sentiment</span>
            <span class="acc-badge" style="color:${sentBadgeColor(s.label)}">${escapeHtml(s.label || "")}</span>
          </div>
          <span class="chevron">▾</span>
        </div>
        <div class="accordion-body">
          <div class="gauge-wrap">
            <div class="gauge-track">
              <div class="gauge-fill" style="left:${gaugePct}%"></div>
            </div>
            <div class="gauge-labels"><span>Very Negative</span><span>Neutral</span><span>Very Positive</span></div>
          </div>
          <p class="body-text">${escapeHtml(s.explanation || "")}</p>
        </div>
      </div>

      <div class="accordion glass-card-sm" data-open="true">
        <div class="accordion-header" role="button" tabindex="0" aria-expanded="true">
          <div class="accordion-title-row">
            <span class="accordion-title">Fact Check</span>
            <span class="acc-badge" style="color:${factBadgeColor(fc.score)}">${fc.score != null ? fc.score + "/100" : ""}</span>
          </div>
          <span class="chevron">▾</span>
        </div>
        <div class="accordion-body">
          <p class="body-text">${escapeHtml(fc.summary || "")}</p>
          <div class="claim-list">${claims}</div>
        </div>
      </div>
    </div>`;
}

// ── History (localStorage) ────────────────────────────────────────────────────
const HISTORY_KEY = "veris_history";

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

function saveToHistory(data, url, type = "single") {
  if (!data) return;
  const pl = data.political_lean || {};
  const fc = data.fact_check     || {};
  const s  = data.sentiment      || {};

  let source = "Unknown";
  if (url) {
    try { source = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
  }

  const item = {
    id:          Date.now().toString(),
    date:        new Date().toISOString(),
    type,
    url,
    source,
    lean:        pl.label || "Unknown",
    lean_numeric: typeof pl.numeric === "number" ? pl.numeric : 0,
    sentiment:   s.label || "Unknown",
    fact_score:  fc.score != null ? fc.score : null,
    article_type: data.article_type || "",
    summary:     (data.summary || "").substring(0, 200),
  };

  const history = getHistory();
  history.unshift(item);
  if (history.length > 100) history.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// ── History page render ───────────────────────────────────────────────────────
function renderHistoryPage() {
  const history = getHistory();
  const listEl  = document.getElementById("history-list");
  if (!listEl) return;

  if (!history.length) {
    listEl.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">📰</div>
        <p>No analyses yet. Analyze an article to see it here.</p>
      </div>`;
    return;
  }

  const grouped = groupByDate(history);
  listEl.innerHTML = grouped.map(({ label, items }) => `
    <div class="history-group-label">${label}</div>
    ${items.map(item => buildHistoryItem(item)).join("")}
  `).join("");
}

function groupByDate(items) {
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  const groups = { Today: [], Yesterday: [], Earlier: [] };
  items.forEach(item => {
    const d = new Date(item.date); d.setHours(0,0,0,0);
    if (d.getTime() === today.getTime())     groups.Today.push(item);
    else if (d.getTime() === yesterday.getTime()) groups.Yesterday.push(item);
    else groups.Earlier.push(item);
  });

  return Object.entries(groups)
    .filter(([, v]) => v.length)
    .map(([label, items]) => ({ label, items }));
}

function buildHistoryItem(item) {
  const leanClass = (item.lean || "").toLowerCase().includes("left")  ? "left"
                  : (item.lean || "").toLowerCase().includes("right") ? "right"
                  : "center";
  const dateStr = new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const icon    = item.type === "compare" ? "⇄" : "≡";
  const factTag = item.fact_score != null
    ? `<span class="fact-pill">${item.fact_score}/100</span>` : "";

  return `
    <div class="history-item">
      <div class="history-item-icon ${item.type}">${icon}</div>
      <div class="history-item-body">
        <div class="history-item-title">${escapeHtml(item.source || "Article")}</div>
        <div class="history-item-meta">${escapeHtml(item.source)} · ${dateStr}</div>
      </div>
      <div class="history-item-badges">
        <span class="lean-badge ${leanClass}">${escapeHtml(item.lean)}</span>
        ${factTag}
      </div>
    </div>`;
}

// History search filter
document.getElementById("history-search").addEventListener("input", function () {
  const q = this.value.toLowerCase();
  document.querySelectorAll(".history-item").forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? "" : "none";
  });
});

// ── Account page render ───────────────────────────────────────────────────────
function renderAccountPage() {
  const history  = getHistory();
  const total    = history.length;
  const thisMonth = history.filter(h => {
    const d = new Date(h.date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // Stat grid
  const statGrid = document.getElementById("stat-grid");
  if (statGrid) {
    statGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Analyses</div>
        <div class="stat-value" style="color:#22d3ee">${thisMonth}</div>
        <div class="stat-sub">this month</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Saved Total</div>
        <div class="stat-value" style="color:#10b981">${total}</div>
        <div class="stat-sub">all time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Top Lean</div>
        <div class="stat-value" style="font-size:20px;color:#a855f7">${topLean(history)}</div>
        <div class="stat-sub">most common</div>
      </div>`;
  }

  // Top sources
  const topSourcesEl = document.getElementById("top-sources");
  if (topSourcesEl) {
    const counts = {};
    const leans  = {};
    history.forEach(h => {
      counts[h.source] = (counts[h.source] || 0) + 1;
      leans[h.source]  = h.lean;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!sorted.length) {
      topSourcesEl.innerHTML = `<div class="source-row"><span class="source-row-name" style="color:var(--muted)">No data yet</span></div>`;
    } else {
      topSourcesEl.innerHTML = sorted.map(([src, count]) => {
        const lean = leans[src] || "";
        const leanClass = lean.toLowerCase().includes("left")  ? "left"
                        : lean.toLowerCase().includes("right") ? "right" : "center";
        return `
          <div class="source-row">
            <span class="source-row-name">${escapeHtml(src)}</span>
            <div class="source-row-meta">
              <span class="source-row-count">${count} ${count === 1 ? "analysis" : "analyses"}</span>
              <span class="lean-badge ${leanClass}">${escapeHtml(lean)}</span>
            </div>
          </div>`;
      }).join("");
    }
  }

  // Plan usage bars from real data
  const usageEl = document.getElementById("usage-analyses");
  if (usageEl) usageEl.textContent = `${thisMonth} / 100`;
  const fillEl = document.getElementById("fill-analyses");
  if (fillEl) fillEl.style.width = `${Math.min(thisMonth, 100)}%`;
  const savedEl = document.getElementById("usage-saved");
  if (savedEl) savedEl.textContent = `${total} / 200`;
  const fillSaved = document.getElementById("fill-saved");
  if (fillSaved) fillSaved.style.width = `${Math.min((total / 200) * 100, 100)}%`;
}

function topLean(history) {
  const counts = {};
  history.forEach(h => { if (h.lean) counts[h.lean] = (counts[h.lean] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : "—";
}

// Account tab switching
document.querySelectorAll(".account-nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".account-nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".account-tab").forEach(t => t.classList.add("hidden"));
    const tab = document.getElementById("tab-" + btn.dataset.tab);
    if (tab) tab.classList.remove("hidden");
  });
});

// Toggle switches
document.querySelectorAll(".toggle").forEach(toggle => {
  toggle.addEventListener("click", () => {
    const on = toggle.dataset.on === "true";
    toggle.dataset.on = String(!on);
  });
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
urlInput.addEventListener("keydown",  e => { if (e.key === "Enter") analyzeArticle(); });
textInput.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyzeArticle(); });
analyzeBtn.addEventListener("click", analyzeArticle);

// ── Init ──────────────────────────────────────────────────────────────────────
initAccordions();
