# Veris Chrome Extension — v1 Design

Date: 2026-05-01

## Goal

A toolbar-launched, anonymous Chrome extension that runs the current tab's URL through the existing Veris `/analyze` backend and shows a results card mirroring the veris.news results page.

## Non-goals (deferred)

- Auto-detect on news sites (no content script in v1).
- Toolbar badge updates and "analysis ready" notifications.
- "Broaden Your View" alternative-coverage section.
- Framing accordion / per-claim breakdown.
- Sign-in / sync to website history.
- Chrome Web Store publish.
- Article-body extraction in the page (v1 sends URL only and lets the backend fetch).

## User flow

```
[user clicks toolbar icon]
        ↓
popup opens · idle state
  ┌────────────────────────────────┐
  │ veris                       ×  │
  │ ─────────────────────────────  │
  │ [favicon]  nytimes.com         │
  │            <article title>     │
  │                                │
  │ [ Analyze this page ]          │
  └────────────────────────────────┘
        ↓ user clicks Analyze
popup · loading state (rotating: Fetching → Reading → Checking → Finding → Finalizing)
        ↓ /analyze returns
popup · results state — header + 3 score cards + summary + "Open full report ↗"
```

If the active tab's URL is not `http(s)://...` (e.g., `chrome://`, `about:`, `file://`), the idle state replaces the Analyze button with the message "This page can't be analyzed."

## Repo layout

New top-level folder in the existing repo:

```
extension/
  manifest.json          # MV3, action popup only
  popup/
    popup.html
    popup.css            # Lifted from scaffold, trimmed
    popup.js             # State machine: idle / loading / results / error
  background/
    service-worker.js    # Holds last result keyed by tabId+url; calls /analyze
  lib/
    api.js               # POST {url} → API_BASE + "/analyze"
  icons/
    icon-16.png  icon-32.png  icon-48.png  icon-128.png
  README.md              # Load-unpacked dev instructions
```

Permissions reduce to `["activeTab"]`. No `host_permissions`, no `content_scripts`, no `notifications`.

## Architecture

**popup.js** is a small state machine with four render functions: `renderIdle`, `renderLoading`, `renderResults`, `renderError`. It opens by reading the active tab's URL/title via `chrome.tabs.query({active: true, currentWindow: true})` and showing the idle state.

**background/service-worker.js** holds an in-memory `Map<tabId+url, {status, result}>`. Receives `ANALYZE` and `GET_STATE` messages from the popup. On `ANALYZE` it calls `lib/api.js` and broadcasts `ANALYSIS_COMPLETE` so a still-open popup can update without polling.

**lib/api.js** exports one function: `analyzeArticle(url)` → `POST API_BASE/analyze` with `{url}` and returns the parsed `{success, data, error}` envelope. `API_BASE` is hardcoded to `https://media-bias-analyzer-production.up.railway.app` for v1.

The popup reuses the same per-tab cache: re-clicking the icon on an already-analyzed tab skips the loading state and renders results directly.

## Backend changes

One line in `backend/main.py` CORS config:

```python
allow_origin_regex=r"chrome-extension://.*"
```

Added alongside the existing `allow_origins` list. This lets unpacked-dev (random extension ID per machine) and a future Web Store-published extension (fixed ID) both through. Nothing else in the backend changes for v1 — anonymous `/analyze` already works.

## Response → popup mapping

Backend `/analyze` returns:

```json
{
  "success": true,
  "data": { ... analyzer JSON ... },
  "source_url": "...",
  "text_preview": "..."
}
```

Popup reads from `data` using the same field names the website's `script.js` already consumes. Specifically: a title (`data.title || data.headline`), the source name/domain, the three score cards (`data.scores.lean`, `data.scores.tone`, `data.scores.facts`), and a short summary paragraph (`data.summary`, truncated to ~280 chars).

"Open full report ↗" navigates to `https://veris.news/?id=<analysis_id>` if the site supports that retrieval pattern; otherwise the button falls back to the home URL with a query param the site can ignore. **TODO during implementation:** confirm the site's deep-link convention by reading the existing routing in `frontend/script.js`.

## Loading UX

Reuse the website's `_LOADING_STAGES` array (Fetching → Reading framing → Checking facts → Finding alternative perspectives → Finalizing) with the same setTimeout cadence. The scaffold's CSS already includes a conic-gradient spinner ring; we keep it.

## Icons

Resize `frontend/files/veris-appicon.png` to 16, 32, 48, 128 px and drop into `extension/icons/`. Use `sips` (built-in on macOS) or imagemagick.

## Testing plan

1. **Local backend, unpacked extension**:
   - Start `uvicorn` locally on `:8000`. Temporarily flip `API_BASE` in `lib/api.js` to `http://localhost:8000`.
   - `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
   - Visit a known-good news article (e.g., a BBC story) → click toolbar icon → click Analyze.
   - Verify: idle shows tab title + domain, loading cycles through messages, results show three score cards + summary + Open full report button.

2. **Production backend, unpacked extension**:
   - Flip `API_BASE` back to Railway URL. Reload extension.
   - Repeat the same article → verify CORS passes (no console error in the popup's DevTools).

3. **Edge cases**:
   - Click icon on `chrome://extensions` itself → popup shows "This page can't be analyzed."
   - Click icon on a 404 / paywalled / non-article page → backend returns an error → popup shows error state with retry.
   - Click icon, click Analyze, close popup before it finishes → re-open popup → it should re-render the loading or completed state from the background's per-tab cache.

4. **Stretch**: confirm same article analyzed twice in a row hits the backend's `content_hash` cache (fast second response).

## Decisions resolved during brainstorming

- **Scope**: Bare-bones useful (option A) — three score cards + summary + open-full-report.
- **Auto-analyze on icon click**: No (option B) — confirmation step protects against accidental quota/cost burn.
- **Code location**: Inside the existing repo (option A) under `extension/`.
- **Auth**: Anonymous in v1. No sign-in.

## Open implementation TODOs

- Confirm the veris.news deep-link convention (`?id=<id>` or otherwise) before wiring "Open full report".
- Decide where `API_BASE` lives — hardcoded constant in `lib/api.js` for v1; a build-time substitution can come later if/when staging vs. prod diverge.
