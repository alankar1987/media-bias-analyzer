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

import { analyzeUrl, getUsage } from "../lib/api.js";
import { signIn, signOut, getSession } from "../lib/auth.js";

// Anonymous extension users get N free analyses before we require sign-in.
// This is a soft, client-side conversion gate — the backend still has its
// own quota for signed-in users. Lives in chrome.storage.local so it
// persists across worker restarts but resets if the user clears extension
// data (which we consider fine — that's a friction point itself).
const ANON_FREE_LIMIT = 2;
const ANON_COUNT_KEY = "veris_anon_count";

async function getAnonCount() {
  const obj = await chrome.storage.local.get(ANON_COUNT_KEY);
  return obj[ANON_COUNT_KEY] || 0;
}
async function incrementAnonCount() {
  const next = (await getAnonCount()) + 1;
  await chrome.storage.local.set({ [ANON_COUNT_KEY]: next });
  return next;
}
async function resetAnonCount() {
  await chrome.storage.local.remove(ANON_COUNT_KEY);
}

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

          // Anon conversion gate: after 2 free analyses, require sign-in.
          const session = await getSession();
          if (!session) {
            const count = await getAnonCount();
            if (count >= ANON_FREE_LIMIT) {
              state.set(tabId, { url, status: "error", error: "anon_limit" });
              await saveState();
              sendResponse({ ok: true });
              chrome.runtime
                .sendMessage({ type: "ANALYSIS_COMPLETE", tabId })
                .catch(() => { /* popup likely closed; ignore */ });
              break;
            }
          }

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
          if (envelope.success) {
            state.set(tabId, {
              url,
              status: "done",
              result: envelope.data,
              analysisId: envelope.analysis_id || null,
            });
            // Only successful analyses count toward the anon gate.
            if (!session) {
              try { await incrementAnonCount(); }
              catch (e) { console.warn("[Veris bg] incrementAnonCount failed", e); }
            }
          } else {
            console.warn("[Veris bg] analysis failed:", envelope.error);
            state.set(tabId, { url, status: "error", error: envelope.error || "Analysis failed" });
          }
          await saveState();
          if (!anyAnalyzing()) setKeepAlive(false);

          chrome.runtime
            .sendMessage({ type: "ANALYSIS_COMPLETE", tabId })
            .catch(() => { /* popup likely closed; ignore */ });
          break;
        }

        case "GET_SESSION": {
          const session = await getSession();
          sendResponse({ ok: true, session });
          break;
        }

        case "SIGN_IN": {
          try {
            const session = await signIn();
            // Once signed in, the anon-gate doesn't apply — clear the counter
            // and any tab still parked in the "anon_limit" error state so the
            // popup can re-render to idle (ready to analyze).
            try { await resetAnonCount(); } catch (_) {}
            for (const [tid, entry] of state) {
              if (entry?.error === "anon_limit") state.delete(tid);
            }
            await saveState();
            sendResponse({ ok: true, session });
          } catch (err) {
            console.warn("[Veris bg] sign-in failed", err);
            sendResponse({ ok: false, error: err.message || "Sign-in failed" });
          }
          break;
        }

        case "SIGN_OUT": {
          await signOut();
          sendResponse({ ok: true });
          break;
        }

        case "GET_USAGE": {
          const usage = await getUsage();
          sendResponse({ ok: true, usage });
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
