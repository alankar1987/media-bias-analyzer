// Cloudflare Worker entry point for veris.news.
//
// Most requests are static assets served from ./frontend/ via the ASSETS
// binding. The two exceptions are the share-page family of routes, which we
// proxy through to the Railway backend so that:
//
//   1. The browser URL stays on veris.news (good for social previews + branding).
//   2. The HTML and OG image both come from FastAPI's `share.py` renderer,
//      with OG meta tags in first-byte HTML so LinkedIn/X/WhatsApp/Slack can
//      parse them without running JS.
//
// `redirect: "manual"` lets the 302 that `/og/{id}.png` returns flow through
// to the client unchanged — without this, the Worker would download the PNG
// itself and re-serve it, defeating the Supabase Storage CDN cache.

const BACKEND_ORIGIN = "https://media-bias-analyzer-production.up.railway.app";

function shouldProxy(pathname) {
  return pathname.startsWith("/a/") || pathname.startsWith("/og/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (shouldProxy(url.pathname)) {
      const upstream = BACKEND_ORIGIN + url.pathname + url.search;
      return fetch(upstream, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      });
    }

    return env.ASSETS.fetch(request);
  },
};
