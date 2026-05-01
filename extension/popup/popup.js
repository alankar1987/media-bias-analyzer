// Veris popup. Renders the appropriate state for the active tab based on
// what the background service worker says is going on.

const root = document.getElementById("root");

const VERIS_HOME = "https://veris.news/";

const LOADING_STAGES = [
  { at: 0,    text: "Fetching the article" },
  { at: 2500, text: "Reading framing" },
  { at: 6000, text: "Checking facts" },
  { at: 9500, text: "Finding alternative perspectives" },
  { at: 13000, text: "Finalizing" },
];

let _loadingTimers = [];

function clearLoadingTimers() {
  _loadingTimers.forEach((t) => clearTimeout(t));
  _loadingTimers = [];
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function header(status) {
  return `
    <div class="vp-head">
      <div class="vp-h-left">
        <div class="vp-logo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <path d="M8 9 L12 17 L16 9"/>
          </svg>
        </div>
        <div>
          <div class="vp-h-name">veris</div>
          <div class="vp-h-status">${escapeHtml(status)}</div>
        </div>
      </div>
      <button class="vp-h-x" id="btn-x" title="Close">×</button>
    </div>
  `;
}

function articleRow(tab) {
  const domain = (() => {
    try { return new URL(tab.url).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  })();
  const title = tab.title || domain || tab.url;
  return `
    <div class="vp-article">
      <div class="vp-article-fav">${escapeHtml((domain[0] || "?").toUpperCase())}</div>
      <div class="vp-article-meta">
        <div class="vp-article-domain">${escapeHtml(domain)}</div>
        <div class="vp-article-title">${escapeHtml(title)}</div>
      </div>
    </div>
  `;
}

function bindClose() {
  document.getElementById("btn-x")?.addEventListener("click", () => window.close());
}

// ── State: idle (analyzable URL, awaiting click) ──
function renderIdle(tab) {
  clearLoadingTimers();
  root.innerHTML = `
    ${header("Ready")}
    ${articleRow(tab)}
    <div class="vp-idle-cta">
      <button class="vp-cta-primary" id="btn-analyze">Analyze this page</button>
    </div>
  `;
  bindClose();
  document.getElementById("btn-analyze")?.addEventListener("click", async () => {
    document.getElementById("btn-analyze").disabled = true;
    console.log("[Veris popup] sending ANALYZE", { tabId: tab.id, url: tab.url, tab });
    await chrome.runtime.sendMessage({ type: "ANALYZE", tabId: tab.id, url: tab.url });
    renderLoading(tab);
  });
}

// ── State: idle but URL isn't analyzable (chrome://, about:, file://, no URL) ──
function renderUnsupported(tab) {
  clearLoadingTimers();
  root.innerHTML = `
    ${header("Not available")}
    <div class="vp-empty">
      <strong>This page can't be analyzed</strong>
      Veris analyzes news article pages on the open web.
    </div>
  `;
  bindClose();
}

// ── State: loading ──
function renderLoading(tab) {
  clearLoadingTimers();
  root.innerHTML = `
    ${header("Analyzing article…")}
    ${articleRow(tab)}
    <div class="vp-loading">
      <div class="vp-loading-ring"></div>
      <div class="vp-loading-title" id="loading-title">${escapeHtml(LOADING_STAGES[0].text)}</div>
      <div class="vp-loading-sub">This usually takes 5–15 seconds</div>
    </div>
  `;
  bindClose();
  // Schedule rotating progress messages.
  for (const stage of LOADING_STAGES.slice(1)) {
    _loadingTimers.push(setTimeout(() => {
      const el = document.getElementById("loading-title");
      if (el) el.textContent = stage.text;
    }, stage.at));
  }
}

// ── State: results ──
function renderResults(tab, data) {
  clearLoadingTimers();
  // Field map: backend returns the same shape the website's results page consumes.
  // We're defensive about missing fields since the analyzer JSON has evolved.
  const title  = data.title || data.headline || tab.title || "";
  const domain = (() => {
    try { return new URL(tab.url).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  })();
  const sourceName = data.source?.name || domain;

  const scores = data.scores || {};
  const lean   = scores.lean   ?? data.lean   ?? "—";
  const tone   = scores.tone   ?? data.tone   ?? "—";
  const facts  = scores.facts  ?? data.facts  ?? "—";

  const summary = data.summary || "";

  // The website opens a previously-analyzed URL by accepting ?url=<encoded>
  // on the home page (added in Task 9).
  const fullReportHref = `${VERIS_HOME}?url=${encodeURIComponent(tab.url)}`;

  root.innerHTML = `
    ${header("Analyzed · just now")}
    <div class="vp-article">
      <div class="vp-article-fav">${escapeHtml((domain[0] || "?").toUpperCase())}</div>
      <div class="vp-article-meta">
        <div class="vp-article-domain">${escapeHtml(sourceName)}</div>
        <div class="vp-article-title">${escapeHtml(title)}</div>
      </div>
    </div>
    <div class="vp-scores">
      <div class="vp-score">
        <div class="vp-score-label">Lean</div>
        <div class="vp-score-val">${escapeHtml(String(lean))}</div>
      </div>
      <div class="vp-score">
        <div class="vp-score-label">Tone</div>
        <div class="vp-score-val">${escapeHtml(String(tone))}</div>
      </div>
      <div class="vp-score">
        <div class="vp-score-label">Facts</div>
        <div class="vp-score-val">${escapeHtml(String(facts))}</div>
      </div>
    </div>
    ${summary ? `<div class="vp-summary">${escapeHtml(summary)}</div>` : ""}
    <div class="vp-cta">
      <button class="vp-cta-primary" id="btn-full">Open full report on Veris ↗</button>
    </div>
  `;
  bindClose();
  document.getElementById("btn-full")?.addEventListener("click", () => {
    chrome.tabs.create({ url: fullReportHref });
    window.close();
  });
}

// ── State: error ──
function renderError(tab, message) {
  clearLoadingTimers();
  root.innerHTML = `
    ${header("Couldn't analyze")}
    <div class="vp-empty">
      <strong>Analysis failed</strong>
      ${escapeHtml(message || "Please try again.")}
      <br/><button class="vp-retry" id="btn-retry">Try again</button>
    </div>
  `;
  bindClose();
  document.getElementById("btn-retry")?.addEventListener("click", () => {
    if (tab && tab.url) renderIdle(tab);
  });
}

// ── Boot ──
async function init() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!resp || !resp.ok) {
    renderError(null, "Background service worker unavailable");
    return;
  }
  const tab = resp.tab;
  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    renderUnsupported(tab);
    return;
  }
  if (resp.status === "analyzing") renderLoading(tab);
  else if (resp.status === "done") renderResults(tab, resp.entry.result);
  else if (resp.status === "error") renderError(tab, resp.entry?.error);
  else renderIdle(tab);
}

// Live updates if analysis completes while popup is open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ANALYSIS_COMPLETE") init();
});

init();
