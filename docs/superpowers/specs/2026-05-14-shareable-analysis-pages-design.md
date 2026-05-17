# Shareable analysis pages — design

**Status:** Approved, ready to plan
**Date:** 2026-05-14
**Owner:** Alankar

## Problem

Users have asked for a way to share a Veris analysis result on LinkedIn, X, WhatsApp, etc. Today, an analysis lives only inside the user's session (popup) or behind the auth-gated `My History` page — there is no public URL to point friends at, and pasting the article URL just sends them to the original outlet, losing the Veris analysis entirely.

A share feature does three jobs at once:

1. **Lets users actually share** what they found interesting.
2. **Acts as a growth loop** — every share is a free, credibility-laden ad for Veris.
3. **Builds public artifacts** that demonstrate what Veris does to first-time visitors.

## Goals

- Every signed-in user can take any analysis from their history and share a public URL.
- The shared URL renders a polished, full analysis page that anyone can view without signing in.
- Rich previews (Open Graph + Twitter Card) work correctly on LinkedIn, X, WhatsApp, Slack, iMessage, Facebook.
- The shared page is brand-consistent with veris.news and converts visitors into trial users via a clear CTA.

## Non-goals

- Letting **anonymous** users generate share links (they can sign in first).
- Threaded comments, reactions, "likes" on shared analyses.
- Editing or annotating an analysis before sharing.
- A public directory of shared analyses or trending list. (URLs are unlisted by default; only people with the link can find them.)
- SEO-indexing the share pages. (Decision is `noindex, nofollow` for v1 — see Decisions below.)

## Decisions

- **Architecture:** FastAPI (Railway) serves both the share page HTML and the OG image. Cloudflare Pages routes `/a/*` and `/og/*` to Railway. *Rationale: reuses existing stack; OG meta tags must be in first-byte HTML, which static Cloudflare Pages can't do on its own. Cloudflare Pages Functions would also work but introduce a new runtime layer for no extra capability.*
- **Auth model:** Sharing requires sign-in. *Rationale: every shared analysis must be a stable DB row with an ID; anonymous analyses today are cache-only and have no stable identity.*
- **Default visibility:** All signed-in users' analyses are shareable by default. *Rationale: Letterboxd model — public-by-default-but-unlisted. The UUID id is unguessable; nobody finds your share unless you give them the link.*
- **Off-switch:** A `shareable BOOLEAN DEFAULT TRUE` column on `analyses` lets a user retract a share. If false, `/a/{id}` returns 404. *Rationale: needed for take-down requests and user trust.*
- **SEO indexing:** `/a/{id}` pages return `<meta name="robots" content="noindex, nofollow">`. *Rationale: avoids reviewing every share for content quality before letting Google index it. One-line change to flip later if we want SEO traffic.*
- **OG image generation:** Pillow (Python) renders the PNG server-side at first request and caches it in Supabase Storage. *Rationale: no new infrastructure, no edge runtime; ~100ms generation time; cache hit is a static file served by Supabase CDN.*
- **No PII on shared pages.** The public view shows: article URL, headline, source, three scores, analysis prose, biased phrases, perspectives. It never shows who shared it.

## Architecture

```
┌─────────────────────────┐
│  Browser / social card  │
│  GET veris.news/a/<id>  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐    /a/* and /og/* routes
│  Cloudflare Pages       │    proxy to Railway backend.
│  (frontend, static)     │    Everything else served as
│                         │    static files (existing).
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐    /a/{id}  → HTML w/ OG meta
│  FastAPI on Railway     │    /og/{id}.png → PNG (cached)
│                         │    Both READ analyses table
│                         │    by ID; auth NOT required.
└────────────┬────────────┘
             │
   ┌─────────┴──────────┐
   ▼                    ▼
┌──────────┐    ┌────────────────┐
│ Supabase │    │ Supabase       │
│ analyses │    │ Storage        │
│ table    │    │ og-cards/      │
└──────────┘    └────────────────┘
```

### Components

**Backend (FastAPI / Python)**

- `backend/share.py` (new module)
  - `render_share_html(analysis: dict) -> str` — produces the full share page HTML with OG meta, Veris styles, and analysis content. Pure function, no DB I/O.
  - `render_og_image(analysis: dict) -> bytes` — renders the 1200×630 PNG with Pillow. Pure function.
  - `get_or_create_og_png(analysis_id, supabase) -> str` — checks Supabase Storage for `og-cards/{id}.png`; if missing, generates and uploads. Returns the public URL.

- `backend/main.py` (modified)
  - `GET /a/{analysis_id}` — fetches the row by id, returns rendered HTML. 404 if `shareable=false` or row not found.
  - `GET /og/{analysis_id}.png` — calls `get_or_create_og_png`, redirects to the Supabase Storage URL (so we get CDN caching for free). Cache-Control header set on the redirect.

- `backend/db.py` (modified)
  - `get_public_analysis(analysis_id: str) -> Optional[dict]` — no user-id check, but enforces `shareable=true`. Returns None otherwise.
  - `set_shareable(analysis_id: str, user_id: str, shareable: bool)` — for the off-switch.

- `backend/requirements.txt` — add `Pillow==10.4.0`.
- `backend/assets/DMSans-Regular.ttf`, `backend/assets/DMSans-Bold.ttf` — bundle DM Sans for OG image text. Both files committed to the repo.

**Frontend (Cloudflare Pages)**

- `frontend/_redirects` — Cloudflare Pages rewrite rule that proxies `/a/*` and `/og/*` to Railway. Two lines:
  ```
  /a/*   https://media-bias-analyzer-production.up.railway.app/a/:splat   200
  /og/*  https://media-bias-analyzer-production.up.railway.app/og/:splat  200
  ```
  Status `200` (not `301/302`) makes Cloudflare proxy the response back under the veris.news domain — the browser/crawler never sees the Railway URL.
- `frontend/script.js` (modified) — after a successful analysis on `veris.news`, render a Share row in the results section. Same row appears on `My History`. Buttons call `window.open` on intent URLs.
- `frontend/history.js` (modified) — small share icon in each history row.
- `frontend/style.css` (modified) — share-row styles.

**Chrome extension**

- `extension/popup/popup.js` (modified) — after analysis renders, append a Share row to results, but only when signed in (anonymous popup analyses are not in the DB). Buttons use `chrome.tabs.create` for intent URLs; copy uses `navigator.clipboard.writeText`.
- `extension/popup/popup.css` (modified) — share-row styles.

**Database**

- `analyses` table — add column `shareable BOOLEAN DEFAULT TRUE NOT NULL` (Supabase migration).

**Storage**

- New Supabase Storage bucket `og-cards`, public read, authenticated write (service role only).

### Data flow: first share

1. Signed-in user analyzes an article. `POST /analyze` writes a row to `analyses` (already happens).
2. Frontend receives `{id, ...}` in the response; renders the share row with `https://veris.news/a/{id}` as the canonical link.
3. User clicks "Share on LinkedIn". Frontend opens `https://www.linkedin.com/sharing/share-offsite/?url=https://veris.news/a/{id}` in a new tab.
4. LinkedIn's crawler fetches `https://veris.news/a/{id}`. Cloudflare Pages proxies the request to Railway. Railway returns HTML with `<meta property="og:image" content="https://veris.news/og/{id}.png">`.
5. LinkedIn fetches the OG image URL. Cloudflare proxies to Railway. Railway calls `get_or_create_og_png`:
   - Check Supabase Storage for `og-cards/{id}.png`. Not found.
   - Generate via Pillow. Upload to Storage. Get back the public URL.
   - 302 redirect LinkedIn to the Storage URL.
6. LinkedIn caches the OG image. The post renders with a rich card.

### Data flow: subsequent share

Step 5 changes — the file exists in Storage, so we just redirect to its URL. No Pillow work.

### Data flow: human visits a shared link

1. Browser GETs `veris.news/a/{id}`.
2. Cloudflare → Railway → Railway returns full HTML with OG meta and rendered analysis.
3. Browser also requests `/og/{id}.png` (the OG image — already in HTML). Cloudflare → Railway → 302 → Supabase Storage CDN.
4. User sees the share page with the actual analysis, the colored score cards, the Veris brand, and a footer CTA "Analyze your own article →" that links to `veris.news/`.

## Share page UX

Visual reference: the mockup approved on 2026-05-14 is preserved at `docs/superpowers/mockups/2026-05-14-share-page-mockup.html` for posterity.

The share page contains:

- **Nav** — Veris brand mark + "Analyze your own →" CTA in the top right.
- **Ribbon** — small pill: "Analyzed on Veris · {date}".
- **Headline** — the article's headline, ~32px.
- **Meta row** — source name + link out to the original article (opens in new tab, `rel="noopener noreferrer"`).
- **Three score cards** — political lean, tone, facts. Identical visual treatment to the existing results page (cyan / green / amber colour coding).
- **Summary prose** — the analysis paragraph.
- **Accordions** — biased language, fact-check breakdown, sources cited. Collapsed by default to keep the share view scannable; click to expand. (Identical to the existing results page accordions.) Implementation note: the share page HTML ships a small inline `<script>` for accordion toggle + copy-link interactions — no external JS bundle required.
- **Broaden your view** — three perspective cards with Google search links. Same as the existing results page.
- **Share row** — X, LinkedIn, WhatsApp, Copy link buttons. Same row that appears on the user's own results page.
- **Footer CTA** — gradient card: "Read news with clearer eyes." + "Analyze your article →" button to `veris.news/`.

## OG image design

1200 × 630px PNG, rendered by Pillow:

- Background — `#080b0f` (the site `--bg` token) with two radial gradients (cyan top-left, purple bottom-right). All colour tokens used in the OG image come from `frontend/style.css` `:root` to keep the brand consistent.
- Brand block (top-left) — circular gradient mark with "V" + "veris" wordmark.
- Source line — uppercase, muted, e.g. `THE GUARDIAN  ·  85/100 FACTS`.
- Headline — large (56px), bold, max 3 lines, truncated with ellipsis.
- Score row (bottom) — three cards: Lean, Tone, Facts. Each card has a label and a coloured value matching the website (cyan for lean, green for high tone/facts, etc.).

Pillow plan: draw all elements with `ImageDraw`. Use DM Sans Bold / Regular bundled as `.ttf` files. No external services. Anti-aliasing via `ImageDraw.text` with stroke for crispness.

## Share button placement

| Location | Behaviour |
|---|---|
| `veris.news` results page (after analysis) | Share row appears below the analysis, above the footer CTA. Same row design as the share page itself. |
| `veris.news` "My History" page | Small share icon (right side of each row, next to the lean/facts pills). Clicking opens a tiny dropdown with the 4 buttons. |
| Chrome extension popup, results state | Share row at the bottom of the results panel, above any other CTAs. Only rendered when `_session.user` exists. |

All three trigger the same intent URLs:

- X — `https://x.com/intent/post?text={encoded text}&url={encoded share url}`
- LinkedIn — `https://www.linkedin.com/sharing/share-offsite/?url={encoded share url}`
- WhatsApp — `https://wa.me/?text={encoded text + share url}`
- Copy — `navigator.clipboard.writeText(shareUrl)` then show a 2s "Copied!" toast.

Pre-filled text template: `"{headline}" — analysed on Veris. Lean: {lean}, Facts: {fact_score}/100.`

## Error handling

- `GET /a/{id}` with bad id → 404 HTML page (Veris-branded, "This analysis isn't available.")
- `GET /a/{id}` where `shareable=false` → same 404.
- `GET /og/{id}.png` with bad id → 404 PNG (a 1200×630 fallback with just the Veris logo).
- Pillow rendering failure → log + serve the fallback PNG; do not raise (would break LinkedIn's preview crawl).
- Supabase Storage upload failure → log + still render the PNG inline as bytes (slower path, but at least one good response).

## Testing

**Backend unit tests** (`backend/tests/test_share.py`):

- `render_share_html` produces valid HTML, contains the analysis id, contains an `og:image` tag pointing at `/og/{id}.png`, contains `noindex` robots meta.
- `render_og_image` produces a PNG of the right dimensions, the bytes are non-empty.
- `get_public_analysis` returns None when `shareable=false`.
- `get_public_analysis` returns the row when `shareable=true`.

**Backend integration tests** (`backend/tests/test_main.py`):

- `GET /a/{id}` for a real analysis returns 200 + HTML with og tags.
- `GET /a/{id}` for a non-existent id returns 404.
- `GET /a/{id}` for `shareable=false` returns 404.
- `GET /og/{id}.png` for a fresh analysis returns 302 to a Supabase Storage URL.
- Second `GET /og/{id}.png` skips Pillow (verify by patching it to raise; request should still succeed).

**Manual checks before launch:**

1. Open `veris.news/a/{real-id}` in incognito; verify the page renders with no auth.
2. Paste the URL into LinkedIn's [Post Inspector](https://www.linkedin.com/post-inspector/) — confirm rich preview, no warnings.
3. Paste into Twitter Card Validator — confirm rich preview.
4. Send the URL in a WhatsApp web chat — confirm preview card appears.
5. Send in Slack — confirm preview.
6. Send in iMessage — confirm preview.

## Rollout

Single deploy, no feature flag:

1. Migrate `analyses` table (`shareable` column).
2. Create Supabase Storage bucket `og-cards`.
3. Deploy backend with `/a/{id}` and `/og/{id}.png` routes + Pillow + DM Sans assets.
4. Configure Cloudflare Pages routing for `/a/*` and `/og/*`.
5. Deploy frontend + extension with share buttons.

Order matters — backend must be live before the share buttons exist on the frontend, otherwise users get 404s.

## Privacy policy update

Add to `frontend/privacy.html`, under "What we collect" → "If you sign in":

> When you analyze an article while signed in, the analysis is saved to your account and assigned a unique unguessable ID. By default, this analysis can be viewed by anyone who has the link — for example, when you share it on LinkedIn or X. The public view contains only the article URL, headline, source, and analysis. It never shows your name, email, or any other account information. You can disable sharing for any individual analysis from My History.

## Open questions

None — design is approved. All decisions resolved above.

## Out of scope (future work, not part of this spec)

- The off-switch UI in My History (column is added, but the toggle UI ships in a follow-up).
- Custom social preview text per share (right now we use one template).
- An "embed code" for putting the analysis card on a third-party blog.
- Indexing the share pages for SEO (would require a separate review of content quality, robots.txt, sitemap.xml).
