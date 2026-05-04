// Veris analysis API client.
//
// v1 sends the URL only; the backend fetches and analyzes it (same as the
// veris.news website). Returns the existing envelope:
//   { success: true,  data: {...analysis...}, source_url, text_preview }
//   { success: false, error: "...", source_url }
//
// If a Supabase session is stored locally, sends Authorization: Bearer <jwt>
// so the backend counts the analysis against the user's quota and saves it
// to /my-history. Anonymous calls (no token) still work — backend's
// chrome-extension origin bypass handles them.

import { getToken } from "./auth.js";

const API_BASE = "https://media-bias-analyzer-production.up.railway.app";

export async function analyzeUrl(url) {
  const headers = { "content-type": "application/json" };
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const resp = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers,
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

export async function getUsage() {
  const token = await getToken();
  if (!token) return null;
  try {
    const resp = await fetch(`${API_BASE}/auth/usage`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();   // { used, limit, tier }
  } catch {
    return null;
  }
}
