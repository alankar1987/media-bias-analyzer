// Veris background service worker.
//
// Holds per-tab analysis state so re-opening the popup on the same tab
// shows results without re-calling the backend.
//
// Two reliability concerns the simple in-memory cache doesn't handle:
//   1. MV3 service workers can be terminated when idle. State is mirrored to
//      chrome.storage.session so a worker restart can rehydrate.
//   2. Fresh /analyze calls take 60-120s on the backend (Claude is slow). To
//      keep the worker from being suspended mid-fetch on Chrome's idle timer,
//      we rely on Chrome's documented behavior of keeping the worker alive
//      while a fetch is pending — but ALSO start a chrome.alarms keep-alive
//      that fires every 25s as a belt-and-suspenders measure.

import { analyzeUrl } from "../lib/api.js";

const STORAGE_KEY = "veris_state_v1";
const KEEPALIVE_ALARM = "veris_keepalive";

// tabId(string) -> { url, status: "analyzing" | "done" | "error", result?, error? }
let state = new Map();

// ── Storage hydration ──────────────────────────────────────────────────────
async function loadState() {
  try {
    const obj = await chrome.storage.session.get(STORAGE_KEY);
    const raw = obj[STORAGE_KEY] || {};
    state = new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
  } catch (err) {
    console.warn("[Veris bg] loadState failed", err);
  }
}

async function saveState() {
  try {
    const obj = {};
    for (const [k, v] of state.entries()) obj[String(k)] = v;
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch (err) {
    console.warn("[Veris bg] saveState failed", err);
  }
}

// Hydrate on every worker start (top-level await isn't allowed in MV3 SW
// modules at parse time, so we kick off the load and let GET_STATE await it).
const _hydrated = loadState();

// ── Tab lifecycle ──────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) {
    state.delete(tabId);
    await saveState();
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  state.delete(tabId);
  await saveState();
});

// ── Keep-alive while at least one analysis is in flight ────────────────────
function setKeepAlive(on) {
  if (on) {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24s
  } else {
    chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Just touch storage; the wakeup itself keeps the worker alive a bit longer.
    chrome.storage.session.get(STORAGE_KEY).catch(() => {});
  }
});
function anyAnalyzing() {
  for (const v of state.values()) if (v.status === "analyzing") return true;
  return false;
}

// ── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      await _hydrated;
      switch (msg.type) {
        case "GET_STATE": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const entry = state.get(tab?.id);
          // Invalidate if the tab's current URL differs from the one we analyzed.
          if (entry && entry.url !== tab?.url) {
            state.delete(tab.id);
            await saveState();
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
          console.log("[Veris bg] ANALYZE received", { tabId, url, urlLen: url?.length });
          state.set(tabId, { url, status: "analyzing", startedAt: Date.now() });
          await saveState();
          setKeepAlive(true);
          sendResponse({ ok: true });

          // analyzeUrl throws on network/CORS failures; catch so the spinner
          // doesn't hang and so we always update state + broadcast.
          let envelope;
          try {
            envelope = await analyzeUrl(url);
          } catch (err) {
            console.error("[Veris bg] analyzeUrl threw", err);
            envelope = { success: false, error: err.message || "Network error" };
          }
          const elapsed = Date.now() - (state.get(tabId)?.startedAt || Date.now());
          if (envelope.success) {
            console.log(`[Veris bg] analysis done in ${elapsed}ms`, { tabId });
            state.set(tabId, { url, status: "done", result: envelope.data });
          } else {
            console.warn(`[Veris bg] analysis failed in ${elapsed}ms`, envelope.error);
            state.set(tabId, { url, status: "error", error: envelope.error || "Analysis failed" });
          }
          await saveState();
          if (!anyAnalyzing()) setKeepAlive(false);

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
