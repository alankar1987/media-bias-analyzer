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
