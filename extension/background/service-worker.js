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
          // analyzeUrl throws on network/CORS failures; if we don't catch that here
          // the outer try/catch fires AFTER sendResponse, leaving state stuck on
          // "analyzing" and the popup spinning forever.
          let envelope;
          try {
            envelope = await analyzeUrl(url);
          } catch (err) {
            console.error("[Veris bg] analyzeUrl threw", err);
            envelope = { success: false, error: err.message || "Network error" };
          }
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
