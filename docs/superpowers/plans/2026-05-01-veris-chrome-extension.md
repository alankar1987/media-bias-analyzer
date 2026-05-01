# Veris Chrome Extension v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Manifest V3 Chrome extension that runs the active tab's URL through the existing Veris `/analyze` backend (anonymous) and renders a results card mirroring the veris.news results page.

**Architecture:** A toolbar-only MV3 extension under a new `extension/` folder. No content script, no auto-detect. The popup is a small idle/loading/results state machine; the background service worker holds an in-memory result cache keyed by `tabId+url` so re-opening the popup on the same tab skips re-analysis. One backend change (CORS) and one tiny site change (`?url=` autofill) round out the round-trip.

**Tech Stack:** Chrome Manifest V3, vanilla JS/HTML/CSS for the popup (matching the website's stack), FastAPI for the existing backend, `qlmanage` + `sips` (built-in macOS) for icon rasterization.

**Verification model:** This is a UI shell over a single `fetch` call plus a CORS config tweak. Unit tests have low ROI vs. the cost; verification is end-to-end manual testing on a real Chrome browser, with explicit checklists in Tasks 9 and 10.

---

## File Structure

```
extension/                                NEW
├── manifest.json                         MV3 manifest, action popup, activeTab only
├── popup/
│   ├── popup.html                        Shell that loads CSS + JS
│   ├── popup.css                         Styles (lifted from scaffold, trimmed)
│   └── popup.js                          State machine + render functions
├── background/
│   └── service-worker.js                 Per-tab result cache + message router
├── lib/
│   └── api.js                            POST {url} → /analyze
├── icons/
│   ├── icon-16.png                       Toolbar (small)
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png                      Web Store / install dialog
└── README.md                             Load-unpacked dev steps

backend/main.py                           MODIFY: add chrome-extension://* CORS regex
frontend/script.js                        MODIFY: ?url=<...> autofill on home page load
```

---

## Task 1: Backend CORS — allow `chrome-extension://*` origin

**Files:**
- Modify: `backend/main.py:45-56`

The existing CORS config has a hard-coded allowlist. Unpacked dev extensions get a random ID per machine (`chrome-extension://<random32chars>`) and the eventual Web Store ID is also unknown, so we add a regex that matches any `chrome-extension://` origin.

- [ ] **Step 1: Read the current CORS block**

Read `backend/main.py` lines 45-56 to confirm the current shape:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://veris.news",
        "https://media-bias-analyzer.naik-alankar.workers.dev",
        "http://localhost:8787",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: Add `allow_origin_regex` for chrome-extension origins**

Replace the block with:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://veris.news",
        "https://media-bias-analyzer.naik-alankar.workers.dev",
        "http://localhost:8787",
        "http://localhost:8080",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
```

FastAPI/Starlette's CORSMiddleware ORs `allow_origins` and `allow_origin_regex` together — anything in the list OR matching the regex is allowed.

- [ ] **Step 3: Verify locally with curl**

Start the backend locally:

```bash
cd backend && uvicorn main:app --reload --port 8000
```

In another terminal, simulate a chrome-extension preflight:

```bash
curl -i -X OPTIONS http://localhost:8000/analyze \
  -H "Origin: chrome-extension://abcdefghijklmnopqrstuvwxyz123456" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `HTTP/1.1 200 OK` with `access-control-allow-origin: chrome-extension://abcdefghijklmnopqrstuvwxyz123456` reflected in the response headers. If the origin is missing or 400, the regex isn't being applied.

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(backend): allow chrome-extension origins in CORS for the new extension"
```

---

## Task 2: Extension scaffold — folder + manifest.json

**Files:**
- Create: `extension/manifest.json`

MV3, action popup only. Permissions: `activeTab` (lets us read the active tab's URL/title when the popup is open). No `host_permissions`, no `content_scripts`, no `notifications`. Keeps the install consent dialog minimal.

- [ ] **Step 1: Create the extension directory tree**

```bash
mkdir -p extension/popup extension/background extension/lib extension/icons
```

- [ ] **Step 2: Write `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Veris — Bias & Fact Analysis",
  "version": "0.1.0",
  "description": "Analyze the news article in the current tab for political lean, tone, and factual accuracy.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Veris — analyze this article",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "permissions": ["activeTab"]
}
```

- [ ] **Step 3: Verify the JSON parses**

```bash
python3 -c "import json; json.load(open('extension/manifest.json'))" && echo OK
```

Expected: `OK`. Any error means the JSON is malformed.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(extension): scaffold MV3 manifest (action popup, activeTab only)"
```

---

## Task 3: Icons — rasterize the brand SVG to 4 PNG sizes

**Files:**
- Create: `extension/icons/icon-16.png`
- Create: `extension/icons/icon-32.png`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-128.png`

Source is `frontend/files/veris-appicon.svg` (256×256, gradient ✓ on dark rounded square). We use `qlmanage` (macOS Quick Look CLI) to render the SVG to a 256px PNG, then `sips` to resize down to each target size. Both tools ship with macOS — no Homebrew required.

- [ ] **Step 1: Render SVG → 256px PNG via qlmanage**

```bash
qlmanage -t -s 256 -o /tmp/ frontend/files/veris-appicon.svg
mv /tmp/veris-appicon.svg.png /tmp/veris-256.png
file /tmp/veris-256.png
```

Expected: `/tmp/veris-256.png: PNG image data, 256 x 256, ...`. If `qlmanage` exits non-zero or produces a 0-byte file, fall back to **Step 1b** below.

- [ ] **Step 1b (fallback): Manual canvas-render in Chrome**

Only if Step 1 failed. Create `/tmp/render-icon.html`:

```html
<!doctype html>
<canvas id="c" width="256" height="256"></canvas>
<script>
  const img = new Image();
  img.onload = () => {
    document.getElementById('c').getContext('2d').drawImage(img, 0, 0, 256, 256);
    const a = document.createElement('a');
    a.href = document.getElementById('c').toDataURL('image/png');
    a.download = 'veris-256.png';
    a.textContent = 'Download';
    document.body.appendChild(a);
  };
  img.src = '/Users/terinaik/Documents/alankar-claude/media-bias-analyzer/frontend/files/veris-appicon.svg';
</script>
```

`open /tmp/render-icon.html` → click the download link → move the file to `/tmp/veris-256.png`.

- [ ] **Step 2: Resize to 4 target sizes**

```bash
for size in 16 32 48 128; do
  sips -z $size $size /tmp/veris-256.png --out extension/icons/icon-$size.png
done
file extension/icons/icon-*.png
```

Expected: four lines reporting `PNG image data, NxN`. Sizes should match the filenames.

- [ ] **Step 3: Commit**

```bash
git add extension/icons/
git commit -m "feat(extension): add 16/32/48/128 toolbar icons rasterized from veris-appicon.svg"
```

---

## Task 4: Popup HTML shell

**Files:**
- Create: `extension/popup/popup.html`

Minimal shell that pulls in DM Sans (matching the website), the popup's CSS, and the popup script. All rendering happens in `popup.js`.

- [ ] **Step 1: Write `extension/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Veris</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="popup.css" />
</head>
<body>
<div id="root"></div>
<script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup/popup.html
git commit -m "feat(extension): add popup HTML shell"
```

---

## Task 5: Popup CSS — dark theme matching website results page

**Files:**
- Create: `extension/popup/popup.css`

Lifted from the scaffold the user dropped, trimmed to just what the four states (idle, loading, results, error) need. Width fixed at 380px (Chrome's max popup width without scrolling on most monitors).

- [ ] **Step 1: Write `extension/popup/popup.css`**

```css
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:380px;background:#0a0d12;color:#fff;font-family:'DM Sans',system-ui,sans-serif}
#root{min-height:200px}

/* ── Header ─────────────────────────────────────── */
.vp-head{padding:16px 18px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.06)}
.vp-h-left{display:flex;align-items:center;gap:9px}
.vp-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#22d3ee,#a855f7);display:flex;align-items:center;justify-content:center}
.vp-h-name{font-size:15px;font-weight:700;letter-spacing:-.2px}
.vp-h-status{font-size:10.5px;color:rgba(255,255,255,0.45);margin-top:1px}
.vp-h-x{background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:18px}
.vp-h-x:hover{background:rgba(255,255,255,0.06);color:#fff}

/* ── Article preview row (idle + results) ───────── */
.vp-article{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:10px;align-items:flex-start}
.vp-article-fav{width:18px;height:18px;border-radius:4px;background:#444;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;font-family:Georgia,serif;flex-shrink:0;margin-top:2px;text-transform:uppercase}
.vp-article-meta{flex:1;min-width:0}
.vp-article-domain{font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:3px}
.vp-article-title{font-size:13px;line-height:1.45;color:#fff;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* ── Idle state ─────────────────────────────────── */
.vp-idle-cta{padding:14px 18px}
.vp-cta-primary{
  width:100%;padding:12px;border-radius:10px;
  background:linear-gradient(135deg,#22d3ee,#a855f7);color:#000;font-weight:700;
  font-size:13px;border:none;cursor:pointer;font-family:inherit;
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.vp-cta-primary:disabled{opacity:.55;cursor:not-allowed}

/* ── Loading state ─────────────────────────────── */
.vp-loading{padding:36px 24px;text-align:center}
.vp-loading-ring{
  width:48px;height:48px;margin:0 auto 16px;border-radius:50%;
  background:conic-gradient(from 0deg,#22d3ee,#a855f7,#22d3ee);
  -webkit-mask:radial-gradient(circle at center,transparent 18px,#000 19px);
          mask:radial-gradient(circle at center,transparent 18px,#000 19px);
  animation:spin 1.2s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
.vp-loading-title{font-size:14px;font-weight:600;margin-bottom:5px}
.vp-loading-sub{font-size:12px;color:rgba(255,255,255,0.5)}

/* ── Score cards row ───────────────────────────── */
.vp-scores{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:14px}
.vp-score{padding:12px 8px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);text-align:center}
.vp-score-label{font-size:9px;letter-spacing:1.6px;color:rgba(255,255,255,0.45);text-transform:uppercase;margin-bottom:6px;font-weight:600}
.vp-score-val{font-size:15px;font-weight:700;letter-spacing:-.3px;line-height:1.1;text-transform:capitalize}
.vp-score-sub{font-size:10px;color:rgba(255,255,255,0.4);margin-top:3px}

/* ── Summary block ─────────────────────────────── */
.vp-summary{padding:0 18px 14px;font-size:12.5px;line-height:1.55;color:rgba(255,255,255,0.78)}

/* ── Bottom CTA row ────────────────────────────── */
.vp-cta{padding:12px 14px;border-top:1px solid rgba(255,255,255,0.06)}

/* ── Error / empty states ──────────────────────── */
.vp-empty{padding:32px 24px;text-align:center;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.55}
.vp-empty strong{color:#fff;display:block;margin-bottom:6px;font-size:14px}
.vp-empty .vp-retry{margin-top:14px;display:inline-block;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#fff;font:inherit;font-size:12px;cursor:pointer}
.vp-empty .vp-retry:hover{background:rgba(255,255,255,0.06)}
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup/popup.css
git commit -m "feat(extension): add popup CSS for idle/loading/results/error states"
```

---

## Task 6: API client — `lib/api.js`

**Files:**
- Create: `extension/lib/api.js`

One function: `analyzeUrl(url)` that POSTs `{url}` to the backend's `/analyze` endpoint and returns the parsed envelope. No retry, no timeout — those are not needed at v1 since the backend already has `content_hash` caching for fast repeats and a 60s nginx-style timeout would not help if the site itself blocks.

- [ ] **Step 1: Write `extension/lib/api.js`**

```javascript
// Veris analysis API client.
//
// v1 sends the URL only; the backend fetches and analyzes it (same as the
// veris.news website). Returns the existing envelope:
//   { success: true,  data: {...analysis...}, source_url, text_preview }
//   { success: false, error: "...", source_url }

const API_BASE = "https://media-bias-analyzer-production.up.railway.app";

export async function analyzeUrl(url) {
  const resp = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!resp.ok) {
    // Surface the HTTP status as the error so the popup can render it.
    return {
      success: false,
      error: `Backend returned HTTP ${resp.status}`,
      source_url: url,
    };
  }

  return await resp.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/lib/api.js
git commit -m "feat(extension): add /analyze API client"
```

---

## Task 7: Background service worker — per-tab cache + message router

**Files:**
- Create: `extension/background/service-worker.js`

Holds an in-memory `Map<tabId, {url, status, result, error}>`. Two messages from the popup: `ANALYZE` (kicks off analysis for a given URL/tabId) and `GET_STATE` (returns whatever we have for the active tab). Tab navigation invalidates the cached entry. When analysis completes, broadcasts `ANALYSIS_COMPLETE` so a still-open popup can update.

- [ ] **Step 1: Write `extension/background/service-worker.js`**

```javascript
// Veris background service worker.
// Holds per-tab analysis state so re-opening the popup on the same tab
// shows results without re-calling the backend.

import { analyzeUrl } from "../lib/api.js";

// tabId -> { url, status: "analyzing" | "done" | "error", result?, error? }
const state = new Map();

// Clear cached state when a tab navigates to a new URL.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) state.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => state.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "GET_STATE": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const entry = state.get(tab?.id);
          // Invalidate if the tab's current URL differs from the one we analyzed
          // (defensive — onUpdated should already have cleared it).
          if (entry && entry.url !== tab?.url) {
            state.delete(tab.id);
            sendResponse({ ok: true, status: "idle", tab });
            return;
          }
          sendResponse({ ok: true, status: entry?.status ?? "idle", entry, tab });
          break;
        }

        case "ANALYZE": {
          const { tabId, url } = msg;
          if (!tabId || !url) {
            sendResponse({ ok: false, error: "missing tabId or url" });
            return;
          }
          state.set(tabId, { url, status: "analyzing" });
          sendResponse({ ok: true });

          // Fire and forget — the popup uses ANALYSIS_COMPLETE / GET_STATE to update.
          const envelope = await analyzeUrl(url);
          if (envelope.success) {
            state.set(tabId, { url, status: "done", result: envelope.data });
          } else {
            state.set(tabId, { url, status: "error", error: envelope.error || "Analysis failed" });
          }
          chrome.runtime
            .sendMessage({ type: "ANALYSIS_COMPLETE", tabId })
            .catch(() => { /* popup likely closed; ignore */ });
          break;
        }

        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (err) {
      console.error("[Veris bg]", err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep channel open for async sendResponse
});
```

- [ ] **Step 2: Commit**

```bash
git add extension/background/service-worker.js
git commit -m "feat(extension): add background service worker with per-tab cache + message router"
```

---

## Task 8: Popup script — state machine + render functions

**Files:**
- Create: `extension/popup/popup.js`

Four render functions (`renderIdle`, `renderLoading`, `renderResults`, `renderError`) plus a small init that asks the background for current state. Loading shows the same rotating progress messages as the website.

- [ ] **Step 1: Write `extension/popup/popup.js`**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup/popup.js
git commit -m "feat(extension): add popup state machine (idle/loading/results/error)"
```

---

## Task 9: Frontend — `?url=<...>` autofill on home page

**Files:**
- Modify: `frontend/script.js` (add a block at the end, near the existing init)

The extension's "Open full report" button links to `https://veris.news/?url=<encoded>`. Make the home page read that query param on load, fill the URL input, and run the existing `analyzeArticle()` flow. The backend's `content_hash` cache means the second analysis is near-instant.

- [ ] **Step 1: Read the existing init block**

Read `frontend/script.js:840-870` to confirm where the keyboard shortcuts and DOMContentLoaded init live. The end of the file (around line 850) is the append point.

- [ ] **Step 2: Append `?url=` autofill block**

Add to the end of `frontend/script.js`:

```javascript
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
```

- [ ] **Step 3: Smoke-test locally**

Open `frontend/index.html` in a browser (or `python3 -m http.server 8080` from `frontend/` then visit `http://localhost:8080/?url=https%3A%2F%2Fwww.bbc.com%2Fnews%2Fworld-12345`).

Expected: the URL input is pre-filled with the BBC URL and the analyze flow runs automatically (you'll see the existing rotating progress messages on the analyze button). It's fine if the request errors because the BBC URL is fake — the test is that the autofill triggers analyze, not that the analysis succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/script.js
git commit -m "feat(frontend): auto-analyze when home page loads with ?url= query param"
```

---

## Task 10: README + manual end-to-end test

**Files:**
- Create: `extension/README.md`
- Modify (optional): root `README.md` to mention the extension

Manual testing happens against the real Railway prod backend. Don't ship until every checkbox below passes.

- [ ] **Step 1: Write `extension/README.md`**

```markdown
# Veris Chrome Extension

A toolbar Chrome extension (MV3) that analyzes the article in the active tab
through the Veris backend at `https://media-bias-analyzer-production.up.railway.app`.

## Load unpacked (development)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked** and select this `extension/` folder
4. Pin the extension from the puzzle-piece menu in the toolbar

## Use it

1. Navigate to a news article
2. Click the Veris toolbar icon
3. Click **Analyze this page**
4. Wait ~5–15s for the result card

## Layout

```
extension/
├── manifest.json          MV3 manifest
├── popup/                 popup HTML/CSS/JS state machine
├── background/            service worker (per-tab result cache)
├── lib/api.js             /analyze client
└── icons/                 16/32/48/128 PNGs (rasterized from veris-appicon.svg)
```

## Backend dependency

The extension calls `POST /analyze` with `{url}` and expects the existing
JSON envelope (`{success, data, error, source_url}`). CORS for
`chrome-extension://*` origins is granted in `backend/main.py`.

## Limits in v1

- Anonymous only — no sign-in, no quota tracking, no history sync to veris.news
- No auto-detect on news sites; user must click the toolbar icon
- No alt-coverage / framing accordion in the popup
- Not yet on the Chrome Web Store
```

- [ ] **Step 2: Backend deploy — push CORS change to Railway**

The backend deploys automatically on push to `main`. Confirm the latest commit on `main` includes the CORS regex from Task 1, then push:

```bash
git log --oneline -5
git push origin main
```

Wait ~60 seconds. Verify the deployed backend has the change:

```bash
curl -i -X OPTIONS https://media-bias-analyzer-production.up.railway.app/analyze \
  -H "Origin: chrome-extension://abcdefghijklmnopqrstuvwxyz123456" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: 200 with `access-control-allow-origin: chrome-extension://abcdefghijklmnopqrstuvwxyz123456` reflected. If you see the production backend rejecting the origin, the deploy hasn't happened yet — check the Railway dashboard.

- [ ] **Step 3: Frontend deploy — push `?url=` autofill to Cloudflare**

Cloudflare Workers Static Assets auto-deploys on push to `main` (the `wrangler.toml` was added in a previous commit). After the push from Step 2, visit:

```
https://veris.news/?url=https://www.bbc.com/news
```

Expected: BBC URL auto-fills into the input and the analyze flow runs. If nothing happens, the deploy is still propagating — Cloudflare typically takes <30s.

- [ ] **Step 4: Load the unpacked extension in Chrome**

1. `chrome://extensions` → Developer mode ON → **Load unpacked** → select `/Users/terinaik/Documents/alankar-claude/media-bias-analyzer/extension/`
2. Confirm the toolbar shows the gradient ✓ icon (not the default puzzle piece). If it's the puzzle piece, the icon files are missing or invalid — re-run Task 3.
3. Pin the extension.

- [ ] **Step 5: Manual end-to-end test checklist**

Walk every row. All must pass before declaring v1 shipped.

| # | Test | Expected |
|---|------|----------|
| 1 | Open a real news article (e.g., `https://www.bbc.com/news/world-us-canada-...` — pick any current article). Click the Veris toolbar icon. | Popup opens in **idle** state showing the article title, BBC domain ("bbc.com"), and a gradient "Analyze this page" button. |
| 2 | Click **Analyze this page**. | Popup transitions to **loading** state. Spinner ring rotates. Title text cycles: "Fetching the article" → "Reading framing" → "Checking facts" → "Finding alternative perspectives" → "Finalizing". |
| 3 | Wait for analysis to complete. | Popup transitions to **results** state. Three score cards (Lean / Tone / Facts) show non-empty values. A summary paragraph appears below the scores. "Open full report on Veris ↗" button at the bottom. |
| 4 | Click "Open full report on Veris ↗". | A new Chrome tab opens to `https://veris.news/?url=<the-article-url>` and the home page auto-fills the URL and starts analyzing it (you'll see the website's own rotating progress messages on the analyze button). |
| 5 | Close the popup, then re-click the toolbar icon (still on the same article tab). | Popup opens directly in **results** state (cached) — no loading screen, no second backend call. |
| 6 | In the same tab, navigate to a different article. Click the toolbar icon. | Popup opens in **idle** state again (the navigation invalidated the per-tab cache). |
| 7 | Open `chrome://extensions` itself. Click the toolbar icon. | Popup shows **unsupported** state: "This page can't be analyzed." No analyze button. |
| 8 | Open a paywalled or 404 article URL where the backend can't extract text. Click Analyze. | Popup transitions to loading, then to **error** state with the backend's error message and a "Try again" button. Clicking Try again returns to idle. |
| 9 | Open Chrome DevTools on the popup (right-click toolbar icon → "Inspect popup"). Run through #1–4 again. | No console errors. The fetch to `media-bias-analyzer-production.up.railway.app/analyze` returns 200 with the expected JSON envelope. CORS doesn't block the request (no red CORS error in console). |
| 10 | Re-analyze the same article from #1 a second time. Time it. | Backend `content_hash` cache hits — the loading screen lasts <2s. Result rendered. |

- [ ] **Step 6: Commit README and final cleanup**

```bash
git add extension/README.md
git commit -m "docs(extension): add README with load-unpacked instructions and v1 limits"
```

- [ ] **Step 7: Push everything**

```bash
git push origin main
```

This triggers the Railway backend deploy (already done in Step 2 if you pushed then) and the Cloudflare frontend deploy (already done in Step 3). The extension itself is loaded locally — no remote deploy needed.

---

## Self-Review Notes

**Spec coverage check (against `2026-05-01-veris-chrome-extension-design.md`):**
- Goal (toolbar-launched anonymous extension): Tasks 2, 4, 5, 7, 8 ✓
- Repo layout (extension/ folder structure): Tasks 2-8 ✓
- Backend CORS for chrome-extension://*: Task 1 ✓
- Response → popup mapping (lean/tone/facts/summary, defensive): Task 8, renderResults ✓
- Loading UX (rotating stages): Task 8, LOADING_STAGES ✓
- Icons: Task 3 ✓
- Open full report deep-link: Tasks 8 and 9 (button + ?url= autofill on site)
- Testing plan (idle/loading/results/error/cache/unsupported): Task 10, checklist 1-10 ✓
- Non-goals correctly omitted (no content script, no badges, no notifications, no broaden, no auth) ✓

**Type/identifier consistency:**
- `analyzeUrl(url)` defined in lib/api.js and called from background/service-worker.js ✓
- `state.get(tabId)` shape `{url, status, result?, error?}` consistent across worker switch cases and popup's `resp.entry` reads ✓
- `LOADING_STAGES` only used in popup.js ✓

**Placeholder scan:** None. Every code block is concrete, every command has expected output.

**Open TODO from the spec:** "Confirm the site's deep-link convention" — resolved by Task 9 (`?url=` autofill), which is implemented end-to-end.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-05-01-veris-chrome-extension.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for plans like this one where each task is fairly self-contained.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for your review.

**Which approach?**
