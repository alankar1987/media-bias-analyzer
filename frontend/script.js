/* ============================================================
   SignalFrame — Media Bias Analyzer  |  script.js
   ============================================================ */

const API_BASE = "https://media-bias-analyzer-production.up.railway.app";

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

function setLoading(on) {
  analyzeBtn.classList.toggle("loading", on);
  analyzeBtn.disabled = on;
  analyzeBtn.querySelector(".btn-label").textContent = on ? "Analyzing…" : "Analyze Article";
}

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

    renderResults(payload);
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError("Cannot reach the backend. Make sure the FastAPI server is running on port 8000.");
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

  renderSummaryCard(data);
  renderPoliticalLean(data.political_lean);
  renderSentiment(data.sentiment);
  renderFactCheck(data.fact_check);
  renderBroadenSection(data.broaden_your_view);

  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Summary card ──────────────────────────────────────────────────────────────
function renderSummaryCard(data) {
  const pl = data.political_lean || {};
  const s  = data.sentiment      || {};
  const fc = data.fact_check     || {};

  const leanNum  = typeof pl.numeric === "number" ? pl.numeric : 0;
  const sentNum  = typeof s.numeric  === "number" ? s.numeric  : 0;
  const leanSign = leanNum >= 0 ? `+${leanNum}` : String(leanNum);
  const sentSign = sentNum >= 0 ? `+${sentNum}`  : String(sentNum);

  // Pick sum-badge color variant based on lean direction
  const leanVariant = leanNum < -2 ? "cyan" : leanNum > 2 ? "purple" : "green";
  const sentVariant = sentNum < -20 ? "purple" : sentNum > 20 ? "green" : "cyan";

  document.getElementById("summary-badges").innerHTML = `
    <div class="sum-badge sum-badge-${leanVariant}">
      <div class="sum-badge-label">Political Lean</div>
      <div class="sum-badge-value">${escapeHtml(pl.label || "—")} <small style="opacity:.75">(${leanSign})</small></div>
    </div>
    <div class="sum-badge sum-badge-${sentVariant}">
      <div class="sum-badge-label">Sentiment</div>
      <div class="sum-badge-value">${escapeHtml(s.label || "—")} <small style="opacity:.75">(${sentSign})</small></div>
    </div>
    <div class="sum-badge sum-badge-green">
      <div class="sum-badge-label">Fact Check</div>
      <div class="sum-badge-value">${fc.score != null ? fc.score + "/100" : "—"}</div>
    </div>
  `;

  const typeTag = data.article_type
    ? `<span class="article-type-tag">${escapeHtml(data.article_type)}</span>`
    : "";
  document.getElementById("summary-block").innerHTML =
    typeTag + `<p class="body-text">${escapeHtml(data.summary || "")}</p>`;
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
  document.getElementById("spectrum-dot").style.left = `calc(${pct}% - 6px)`;

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

  if (!items || !items.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  grid.innerHTML = items.map(item => `
    <div class="broaden-card">
      <div class="broaden-card-top">
        <span class="broaden-outlet">${escapeHtml(item.outlet)}</span>
        <span class="perspective-tag ${escapeHtml((item.perspective || "").toLowerCase())}">
          ${escapeHtml(item.perspective || "")}
        </span>
      </div>
      <p class="broaden-angle">${escapeHtml(item.angle)}</p>
      <p class="broaden-why">${escapeHtml(item.why)}</p>
    </div>
  `).join("");
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

    renderCompareResults(payload.article1.data, payload.article2.data, label1, label2);
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      showError("Cannot reach the backend. Make sure the FastAPI server is running on port 8000.");
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

  // Wire accordion toggles for the newly injected HTML
  cols.querySelectorAll(".accordion").forEach(acc => {
    const header = acc.querySelector(".accordion-header");
    header.addEventListener("click", () => toggleAccordion(acc));
    header.addEventListener("keydown", e => {
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
      <div class="glass-card result-summary-card">
        <p class="section-label">Summary</p>
        <div class="summary-block">
          ${typeTag}
          <p class="body-text">${escapeHtml(data.summary || "")}</p>
        </div>
      </div>

      <!-- political lean -->
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
              <div class="spectrum-dot" style="left:calc(${pct}% - 6px)"></div>
            </div>
            <div class="spectrum-labels"><span>Left</span><span>Center</span><span>Right</span></div>
          </div>
          <p class="conf-line">${pl.confidence ? "Confidence: " + escapeHtml(pl.confidence) : ""}</p>
          <p class="body-text">${escapeHtml(pl.explanation || "")}</p>
        </div>
      </div>

      <!-- sentiment -->
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

      <!-- fact check -->
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
    </div>
  `;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
urlInput.addEventListener("keydown",  e => { if (e.key === "Enter") analyzeArticle(); });
textInput.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyzeArticle(); });
analyzeBtn.addEventListener("click", analyzeArticle);

// ── Init ──────────────────────────────────────────────────────────────────────
initAccordions();
