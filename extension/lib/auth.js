// Veris auth — Supabase OAuth via chrome.identity.launchWebAuthFlow.
//
// Flow:
//   1. signIn() builds the Supabase Google-OAuth URL with redirect_to set to
//      this extension's chromiumapp.org callback.
//   2. Chrome opens that URL in an OAuth-popup window. User does Google sign-in.
//      Supabase redirects to <ext-id>.chromiumapp.org/oauth#access_token=...
//   3. launchWebAuthFlow captures that final URL and returns it; we parse the
//      hash fragment for access_token + expires_at.
//   4. Token is stored in chrome.storage.local. /analyze calls send it.
//
// One-time setup (per dev extension ID OR per published Web Store ID):
//   Add `https://<ext-id>.chromiumapp.org/oauth` to Supabase Dashboard →
//   Authentication → URL Configuration → Redirect URLs.

const SUPABASE_URL = "https://cxvjuokolqjesxcppovt.supabase.co";
const STORAGE_KEY  = "veris_auth_v1";

// chrome.identity.getRedirectURL() returns
//   https://<extension-id>.chromiumapp.org/<path>
// We use a stable path so Supabase only needs one entry.
function redirectUri() {
  return chrome.identity.getRedirectURL("oauth");
}

export async function signIn() {
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize` +
    `?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUri())}`;

  // launchWebAuthFlow blocks until the user finishes (or cancels). On success,
  // it resolves with the final redirect URL containing the token in the hash.
  const finalUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!finalUrl) throw new Error("Sign-in cancelled");

  const hash = new URL(finalUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token) {
    const err = params.get("error_description") || params.get("error") || "No token returned";
    throw new Error(err);
  }

  const session = {
    access_token: token,
    refresh_token: params.get("refresh_token") || null,
    expires_at: parseInt(params.get("expires_at") || "0", 10),
    token_type: params.get("token_type") || "bearer",
    user: await fetchUser(token),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
  return session;
}

export async function signOut() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function getSession() {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  const session = obj[STORAGE_KEY] || null;
  // Expire stale tokens — Supabase access tokens last ~1h. We don't refresh
  // in v1; user just signs in again.
  if (session && session.expires_at && session.expires_at * 1000 < Date.now()) {
    await signOut();
    return null;
  }
  return session;
}

export async function getToken() {
  const session = await getSession();
  return session?.access_token || null;
}

async function fetchUser(token) {
  // Decode the JWT payload locally — avoids an extra round-trip for the
  // common case (we just need email + sub).
  try {
    const [, payload] = token.split(".");
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return { id: json.sub, email: json.email };
  } catch {
    return { id: null, email: null };
  }
}
