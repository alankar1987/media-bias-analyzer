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

  // Read the body either way — backend includes useful error messages
  // ({success:false, error, message} for rate limits; {detail:"..."} for HTTPException).
  let body = null;
  try { body = await resp.json(); } catch { /* non-JSON body */ }

  if (!resp.ok) {
    const reason =
      body?.detail ||
      body?.message ||
      body?.error ||
      `Backend returned HTTP ${resp.status}`;
    return { success: false, error: reason, source_url: url };
  }

  return body || { success: false, error: "Empty response", source_url: url };
}
