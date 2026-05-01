// Veris popup. Renders the appropriate state for the active tab based on
// what the background service worker says is going on.

const root = document.getElementById("root");

const VERIS_HOME = "https://veris.news/";

// Loading stages roughly track the backend's sequence (extract → frame →
// fact-check → alt-coverage → format). Fresh analyses can take 60-120s on
// long opinion pieces, so the later stages reassure the user we're still
// working rather than hung. Times in ms.
const LOADING_STAGES = [
  { at: 0,     text: "Fetching the article" },
  { at: 2500,  text: "Reading framing" },
  { at: 6000,  text: "Checking facts" },
  { at: 12000, text: "Finding alternative perspectives" },
  { at: 25000, text: "Cross-referencing sources" },
  { at: 45000, text: "Still working — long article" },
  { at: 75000, text: "Almost there" },
  { at: 110000, text: "Wrapping up" },
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
    renderLoading(tab, Date.now());
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
// startedAt is the worker-side timestamp for when /analyze was kicked off.
// When the popup is reopened mid-analysis we want to resume the rotating
// messages from the right point, not start over at "Fetching".
function renderLoading(tab, startedAt) {
  clearLoadingTimers();
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  // Pick the latest stage whose `at` <= elapsed.
  const initial = [...LOADING_STAGES].reverse().find((s) => s.at <= elapsed) || LOADING_STAGES[0];
  root.innerHTML = `
    ${header("Analyzing article…")}
    ${articleRow(tab)}
    <div class="vp-loading">
      <div class="vp-loading-ring"></div>
      <div class="vp-loading-title" id="loading-title">${escapeHtml(initial.text)}</div>
      <div class="vp-loading-sub">Fresh articles can take up to 2 minutes</div>
    </div>
  `;
  bindClose();
  // Schedule remaining stages relative to when the analysis started.
  for (const stage of LOADING_STAGES) {
    if (stage.at <= elapsed) continue;
    _loadingTimers.push(setTimeout(() => {
      const el = document.getElementById("loading-title");
      if (el) el.textContent = stage.text;
    }, stage.at - elapsed));
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

  // Field map: backend returns political_lean / sentiment / fact_check, each
  // with a `.label` (or `.score` for facts). Match what frontend/script.js does.
  const pl = data.political_lean || {};
  const sn = data.sentiment      || {};
  const fc = data.fact_check     || {};
  const lean  = pl.label || "—";
  const tone  = sn.label || "—";
  const facts = fc.score != null ? `${fc.score}/100` : "—";

  // Color cues match veris.news (leanBadgeColor / sentBadgeColor / factBadgeColor).
  const MUTED = "rgba(255,255,255,0.55)";
  const leanColor = (() => {
    const l = (pl.label || "").toLowerCase();
    if (l.includes("left"))  return "#22d3ee";
    if (l.includes("right")) return "#ef4444";
    return MUTED;
  })();
  const toneColor = (() => {
    const l = (sn.label || "").toLowerCase();
    if (l.includes("positive")) return "#10b981";
    if (l.includes("negative")) return "#ef4444";
    return MUTED;
  })();
  const factsColor = (() => {
    if (fc.score == null) return MUTED;
    if (fc.score >= 75) return "#10b981";
    if (fc.score >= 50) return "#f59e0b";
    return "#ef4444";
  })();

  const summary = data.summary || "";

  // ── Broaden Your View — alt-coverage cards ──
  // Each item: { outlet, perspective, angle, why }. We render perspective as
  // a colored tag (CSS class on .vp-bc-tag), and clicking the card opens a
  // Google search for "<outlet> <angle>" — same approach as veris.news.
  const broaden = (data.broaden_your_view || []).slice(0, 3);
  const broadenHtml = broaden.length ? `
    <div class="vp-section">
      <div class="vp-section-h">
        <span>Broaden Your View</span>
        <span class="count">${broaden.length} angle${broaden.length === 1 ? "" : "s"}</span>
      </div>
      <div class="vp-broaden">
        ${broaden.map((b) => {
          const perspective = (b.perspective || "independent").toLowerCase().split(/\s+/)[0];
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent((b.outlet || "") + " " + (b.angle || ""))}`;
          return `
            <a class="vp-bcard" href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">
              <span class="vp-bc-tag ${escapeHtml(perspective)}">${escapeHtml(b.perspective || "")}</span>
              <div class="vp-bc-mid">
                <div class="vp-bc-outlet">${escapeHtml(b.outlet || "")}</div>
                <div class="vp-bc-angle">${escapeHtml(b.angle || "")}</div>
              </div>
              <span class="vp-bc-arrow">↗</span>
            </a>
          `;
        }).join("")}
      </div>
    </div>
  ` : "";

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
        <div class="vp-score-val" style="color:${leanColor}">${escapeHtml(String(lean))}</div>
      </div>
      <div class="vp-score">
        <div class="vp-score-label">Tone</div>
        <div class="vp-score-val" style="color:${toneColor}">${escapeHtml(String(tone))}</div>
      </div>
      <div class="vp-score">
        <div class="vp-score-label">Facts</div>
        <div class="vp-score-val" style="color:${factsColor}">${escapeHtml(String(facts))}</div>
      </div>
    </div>
    ${summary ? `<div class="vp-summary">${escapeHtml(summary)}</div>` : ""}
    ${broadenHtml}
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
  if (resp.status === "analyzing") renderLoading(tab, resp.entry?.startedAt);
  else if (resp.status === "done") renderResults(tab, resp.entry.result);
  else if (resp.status === "error") renderError(tab, resp.entry?.error);
  else renderIdle(tab);
}

// Live updates if analysis completes while popup is open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ANALYSIS_COMPLETE") init();
});

init();
