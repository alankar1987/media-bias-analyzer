# Shareable Analysis Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users share Veris analyses publicly via `veris.news/a/{id}` URLs with rich Open Graph previews on LinkedIn, X, WhatsApp, and Slack.

**Architecture:** FastAPI on Railway serves both the share page HTML (with full OG meta tags in first-byte HTML) and the OG image PNG. Cloudflare Pages rewrites `/a/*` and `/og/*` to Railway. The OG image is rendered server-side with Pillow on first request and cached in a Supabase Storage bucket so subsequent requests are a 302 to the Storage CDN.

**Tech Stack:** FastAPI / Python 3.11+, Pillow 10.4.0, Supabase (Postgres + Storage), Cloudflare Pages (`_redirects`), vanilla JS + CSS for the frontend and Chrome extension touchpoints.

**Spec reference:** `docs/superpowers/specs/2026-05-14-shareable-analysis-pages-design.md`
**Visual reference:** `docs/superpowers/mockups/2026-05-14-share-page-mockup.html`

---

## File map

**New files**

- `backend/share.py` — share-page HTML rendering + OG image generation + storage helpers (one module, three pure-ish functions).
- `backend/assets/DMSans-Regular.ttf`, `backend/assets/DMSans-Bold.ttf` — bundled font files for OG image rendering.
- `backend/tests/test_share.py` — unit tests for the share module.
- `frontend/_redirects` — Cloudflare Pages rewrite rules.
- `frontend/share.js` — small helper module: `buildShareUrl(id)`, `openShareIntent(platform, headline, leanLabel, factScore, shareUrl)`, `copyShareLink(shareUrl)`.

**Modified files**

- `backend/requirements.txt` — add `Pillow==10.4.0`.
- `backend/db.py` — add `get_public_analysis`, `set_shareable`.
- `backend/main.py` — add `GET /a/{id}`, `GET /og/{id}.png`, return `analysis_id` from `/analyze`.
- `backend/tests/test_db.py` — tests for the two new db helpers.
- `backend/tests/test_routes.py` — tests for the two new routes.
- `frontend/index.html` — load `share.js`.
- `frontend/script.js` — render share row on results page after analysis; show toast on copy.
- `frontend/history.js` — render share icon on each history row; small dropdown.
- `frontend/style.css` — `.share-row`, `.share-btn`, `.share-toast` styles.
- `frontend/privacy.html` — add the "Sharing" privacy paragraph.
- `extension/popup/popup.html` — load `share.js` for extension (separate copy).
- `extension/popup/popup.js` — render share row in results state when signed in.
- `extension/popup/popup.css` — share-row styles (extension-flavoured).
- `extension/lib/share.js` — extension-local copy of share intent helpers (uses `chrome.tabs.create`).

**Manual / out-of-code work**

- Run a SQL migration in Supabase to add the `shareable` column.
- Create the `og-cards` Storage bucket with public read.
- After deploy: validate share previews in LinkedIn Post Inspector, Twitter Card Validator, WhatsApp, Slack, iMessage.

---

## Phase 1 — Database & storage prep

### Task 1: Add `shareable` column to `analyses` table

**Files:**
- (Manual) Run SQL in the Supabase SQL Editor — no repo file.

- [ ] **Step 1: Open the Supabase SQL Editor**

Go to https://supabase.com/dashboard → your project (`cxvjuokolqjesxcppovt`) → SQL Editor → "New query".

- [ ] **Step 2: Run the migration**

Paste and run:

```sql
ALTER TABLE analyses
ADD COLUMN shareable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS analyses_id_shareable_idx
  ON analyses (id) WHERE shareable = true;
```

Expected: "Success. No rows returned."

- [ ] **Step 3: Verify the column exists**

In the SQL Editor, run:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'analyses' AND column_name = 'shareable';
```

Expected: one row with `shareable | boolean | true`.

- [ ] **Step 4: Spot-check existing rows**

```sql
SELECT id, shareable FROM analyses LIMIT 5;
```

Expected: every existing row has `shareable = true`.

This task has no commit — it's a database-side change.

---

### Task 2: Create `og-cards` storage bucket

**Files:**
- (Manual) Create the bucket in Supabase Storage.

- [ ] **Step 1: Open the Storage section in Supabase**

Dashboard → Storage → "New bucket".

- [ ] **Step 2: Create the bucket**

- Name: `og-cards`
- Public bucket: **YES** (toggle on — we want anyone to be able to GET the PNG by URL).
- File size limit: 1 MB (defaults are fine; OG cards are <100 KB).
- Allowed MIME types: `image/png`.

Click "Create bucket".

- [ ] **Step 3: Verify the bucket policy**

In the bucket settings, confirm:

- "Public" badge appears next to the bucket name.
- Anonymous role has SELECT permission (Supabase auto-creates this for public buckets).

- [ ] **Step 4: Test public read manually**

Upload any test PNG (right-click the bucket → "Upload file" → pick one). Click the file → "Copy URL". Open the URL in an incognito tab. The PNG should display.

Delete the test PNG when done.

No commit — bucket setup is server-side.

---

## Phase 2 — Backend share module

### Task 3: Add Pillow dependency + bundle DM Sans fonts

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/assets/DMSans-Regular.ttf`
- Create: `backend/assets/DMSans-Bold.ttf`

- [ ] **Step 1: Add Pillow to `backend/requirements.txt`**

Append to the file (keep alphabetical-ish ordering with the existing list):

```
Pillow==10.4.0
```

- [ ] **Step 2: Install locally**

Run:
```bash
cd backend && pip install -r requirements.txt
```

Expected: Pillow installs without error.

- [ ] **Step 3: Download DM Sans TTF files**

DM Sans is licensed under SIL Open Font License, so bundling is fine. Download the two weights from the Google Fonts mirror on GitHub:

```bash
mkdir -p backend/assets
curl -L -o backend/assets/DMSans-Regular.ttf \
  https://github.com/googlefonts/dm-fonts/raw/main/Sans/Roman/exports/static-ttf/DMSans-Regular.ttf
curl -L -o backend/assets/DMSans-Bold.ttf \
  https://github.com/googlefonts/dm-fonts/raw/main/Sans/Roman/exports/static-ttf/DMSans-Bold.ttf
```

Expected: both files are downloaded, each ~80 KB.

- [ ] **Step 4: Verify the fonts load with Pillow**

Run:
```bash
cd backend && python -c "from PIL import ImageFont; f = ImageFont.truetype('assets/DMSans-Bold.ttf', 24); print('OK', f.getlength('Veris'))"
```

Expected: prints `OK <some-number>`. If you see a TrueType error, re-download — the file may be HTML (GitHub 404 page rendered as bytes).

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/assets/DMSans-Regular.ttf backend/assets/DMSans-Bold.ttf
git commit -m "chore(backend): add Pillow + bundle DM Sans for OG image rendering"
```

---

### Task 4: `render_share_html` — share page HTML

**Files:**
- Create: `backend/share.py`
- Create: `backend/tests/test_share.py`

The share page is one self-contained HTML document with inline CSS (so it has no dependency on the frontend Cloudflare Pages assets), the full analysis content, and OG meta tags filled in from the analysis row.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_share.py` with this content:

```python
import os
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))


SAMPLE_ANALYSIS = {
    "id": "11111111-2222-3333-4444-555555555555",
    "url": "https://www.theguardian.com/world/2026/may/01/voting-rights",
    "source_name": "theguardian.com",
    "headline": "Supreme Court's Voting Rights Decision",
    "lean_label": "center-left",
    "lean_numeric": -2,
    "fact_score": 85,
    "shareable": True,
    "created_at": "2026-05-14T12:00:00Z",
    "result_json": {
        "title": "Supreme Court's Voting Rights Decision",
        "political_lean": {
            "label": "center-left",
            "numeric": -2,
            "framing_choices": [],
        },
        "sentiment": {"label": "positive", "numeric": 30},
        "fact_check": {"score": 85, "claims": []},
        "summary": "The article frames the decision as a balance between legal precedent and political consequence.",
        "broaden_your_view": [],
    },
}


def test_render_share_html_contains_analysis_id():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert SAMPLE_ANALYSIS["id"] in html


def test_render_share_html_contains_og_meta_tags():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert '<meta property="og:title"' in html
    assert '<meta property="og:image"' in html
    assert '<meta property="og:url"' in html
    assert '<meta property="og:type" content="article"' in html
    assert '<meta name="twitter:card" content="summary_large_image"' in html


def test_render_share_html_og_image_points_to_og_route():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert f'/og/{SAMPLE_ANALYSIS["id"]}.png' in html


def test_render_share_html_has_noindex_robots_tag():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert '<meta name="robots" content="noindex, nofollow"' in html


def test_render_share_html_contains_headline():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert SAMPLE_ANALYSIS["headline"] in html


def test_render_share_html_contains_score_values():
    from share import render_share_html
    html = render_share_html(SAMPLE_ANALYSIS)
    assert "center-left" in html.lower()
    assert "positive" in html.lower()
    assert "85" in html  # fact score


def test_render_share_html_escapes_unsafe_headline():
    from share import render_share_html
    evil = dict(SAMPLE_ANALYSIS)
    evil["headline"] = '<script>alert(1)</script>'
    evil["result_json"] = dict(SAMPLE_ANALYSIS["result_json"])
    evil["result_json"]["title"] = evil["headline"]
    html = render_share_html(evil)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: all 7 tests fail with `ModuleNotFoundError: No module named 'share'`.

- [ ] **Step 3: Implement `render_share_html` in `backend/share.py`**

Create `backend/share.py` with this content:

```python
"""Share-page rendering + Open Graph image generation.

Three responsibilities, kept in one module because they share data shape and
template constants:

1. render_share_html(analysis)         — public HTML page for /a/{id}
2. render_og_image(analysis)           — 1200x630 PNG bytes for /og/{id}.png
3. get_or_create_og_png(...)           — Storage caching wrapper around (2)
"""

import html as html_escape
import io
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Public site URL — share links and OG image URLs use this base.
SITE_BASE = "https://veris.news"

# DM Sans font files (bundled in backend/assets/).
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")
FONT_REGULAR = os.path.join(ASSETS_DIR, "DMSans-Regular.ttf")
FONT_BOLD = os.path.join(ASSETS_DIR, "DMSans-Bold.ttf")


def _esc(value) -> str:
    """HTML-escape any string we interpolate into the template."""
    if value is None:
        return ""
    return html_escape.escape(str(value), quote=True)


def _lean_color(label: Optional[str]) -> str:
    if not label:
        return "var(--cyan)"
    lower = label.lower()
    if "right" in lower:
        return "var(--red)"
    if "center" in lower or "centrist" in lower or "balanced" in lower:
        return "var(--amber)"
    return "var(--cyan)"


def _fact_color(score: Optional[int]) -> str:
    if score is None:
        return "var(--amber)"
    if score >= 70:
        return "var(--green)"
    if score >= 40:
        return "var(--amber)"
    return "var(--red)"


def _tone_color(label: Optional[str]) -> str:
    if not label:
        return "var(--cyan)"
    lower = label.lower()
    if "positive" in lower:
        return "var(--green)"
    if "negative" in lower:
        return "var(--red)"
    return "var(--amber)"


def render_share_html(analysis: dict) -> str:
    """Return a complete HTML document for a public share page.

    `analysis` is a row from the `analyses` table (already verified shareable).
    Includes Open Graph + Twitter Card meta tags so social platforms render
    rich previews. The HTML is self-contained — no external CSS/JS bundles.
    """
    analysis_id = analysis["id"]
    headline = _esc(analysis.get("headline") or analysis.get("url") or "Veris analysis")
    source = _esc(analysis.get("source_name") or "")
    article_url = _esc(analysis.get("url") or "")
    lean = _esc(analysis.get("lean_label") or "Unknown")
    fact_score = analysis.get("fact_score")
    result = analysis.get("result_json") or {}
    sentiment = _esc((result.get("sentiment") or {}).get("label") or "Neutral")
    summary = _esc(result.get("summary") or "")

    share_url = f"{SITE_BASE}/a/{analysis_id}"
    og_image_url = f"{SITE_BASE}/og/{analysis_id}.png"
    og_description = (
        f"Lean: {lean} · Tone: {sentiment} · Facts: {fact_score if fact_score is not None else '—'}/100. "
        f"Analyzed on Veris."
    )

    lean_color = _lean_color(analysis.get("lean_label"))
    tone_color = _tone_color((result.get("sentiment") or {}).get("label"))
    facts_color = _fact_color(fact_score)
    fact_score_disp = _esc(fact_score if fact_score is not None else "—")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{headline} — analyzed on Veris</title>

<meta property="og:type" content="article">
<meta property="og:title" content="{headline}">
<meta property="og:description" content="{og_description}">
<meta property="og:image" content="{og_image_url}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="{share_url}">
<meta property="og:site_name" content="Veris">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{headline}">
<meta name="twitter:description" content="{og_description}">
<meta name="twitter:image" content="{og_image_url}">

<style>
  :root {{
    --bg: #080b0f;
    --card: rgba(255,255,255,0.04);
    --card-bd: rgba(255,255,255,0.08);
    --text: #f0f4f8;
    --muted: rgba(255,255,255,0.55);
    --muted-md: rgba(255,255,255,0.72);
    --muted-hi: rgba(255,255,255,0.88);
    --cyan: #22d3ee;
    --purple: #a855f7;
    --red: #f87171;
    --amber: #fbbf24;
    --green: #4ade80;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 0;
    background: var(--bg); color: var(--text);
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .nav {{
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 32px; border-bottom: 1px solid var(--card-bd);
    max-width: 1100px; margin: 0 auto;
  }}
  .brand {{ display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; }}
  .brand-mark {{ width: 28px; height: 28px; border-radius: 50%;
    background: linear-gradient(135deg, var(--cyan), var(--purple));
    display: grid; place-items: center; font-weight: 800; color: #0a0a0a; font-size: 14px; }}
  .cta {{ padding: 8px 16px; border-radius: 999px;
    background: linear-gradient(135deg, var(--cyan), var(--purple));
    color: #0a0a0a; font-weight: 600; text-decoration: none; font-size: 13px; }}
  .wrap {{ max-width: 880px; margin: 0 auto; padding: 48px 32px 64px; }}
  .ribbon {{ display: inline-flex; gap: 8px; align-items: center;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(34,211,238,0.09); border: 1px solid rgba(34,211,238,0.22);
    color: var(--cyan); font-size: 12px; font-weight: 600; margin-bottom: 20px; }}
  h1 {{ font-size: 32px; line-height: 1.25; letter-spacing: -0.5px;
    margin: 0 0 14px; font-weight: 700; }}
  .meta {{ display: flex; gap: 14px; align-items: center;
    font-size: 14px; color: var(--muted-md); margin-bottom: 36px; }}
  .meta a {{ color: var(--cyan); text-decoration: none; }}
  .scores {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 32px; }}
  .score-card {{ padding: 22px; border-radius: 14px;
    background: var(--card); border: 1px solid var(--card-bd); }}
  .score-card .label {{ font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--muted); font-weight: 600; margin-bottom: 8px; }}
  .score-card .value {{ font-size: 26px; font-weight: 700; letter-spacing: -0.5px; text-transform: capitalize; }}
  .summary {{ background: var(--card); border: 1px solid var(--card-bd);
    border-radius: 14px; padding: 24px 28px; margin-bottom: 32px; }}
  .summary .label {{ font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--muted); font-weight: 600; margin-bottom: 10px; }}
  .summary p {{ font-size: 15px; line-height: 1.7; color: var(--muted-hi); margin: 0; }}
  .footer-cta {{ margin-top: 48px; padding: 32px; border-radius: 16px;
    background: linear-gradient(135deg, rgba(34,211,238,0.08), rgba(168,85,247,0.08));
    border: 1px solid rgba(168,85,247,0.18); text-align: center; }}
  .footer-cta h3 {{ margin: 0 0 8px; font-size: 22px; }}
  .footer-cta p {{ margin: 0 0 18px; color: var(--muted-md); font-size: 14px; }}
  .footer-cta a {{ display: inline-block; padding: 12px 24px; border-radius: 999px;
    background: linear-gradient(135deg, var(--cyan), var(--purple));
    color: #0a0a0a; font-weight: 600; text-decoration: none; font-size: 14px; }}
</style>
</head>
<body>
<nav class="nav">
  <div class="brand"><div class="brand-mark">V</div><span>veris</span></div>
  <a href="{SITE_BASE}/" class="cta">Analyze your own →</a>
</nav>
<main class="wrap">
  <div class="ribbon">Analyzed on Veris</div>
  <h1>{headline}</h1>
  <div class="meta">
    {f'<span><b>{source}</b></span><span style="opacity:.4">·</span>' if source else ''}
    {f'<a href="{article_url}" target="_blank" rel="noopener noreferrer">View original article ↗</a>' if article_url else ''}
  </div>
  <div class="scores">
    <div class="score-card">
      <div class="label">Political Lean</div>
      <div class="value" style="color: {lean_color}">{lean}</div>
    </div>
    <div class="score-card">
      <div class="label">Tone</div>
      <div class="value" style="color: {tone_color}">{sentiment}</div>
    </div>
    <div class="score-card">
      <div class="label">Facts</div>
      <div class="value" style="color: {facts_color}">{fact_score_disp}/100</div>
    </div>
  </div>
  <section class="summary">
    <div class="label">Summary</div>
    <p>{summary}</p>
  </section>
  <div class="footer-cta">
    <h3>Read news with clearer eyes.</h3>
    <p>Veris analyzes any article for political lean, tone, and factual accuracy.</p>
    <a href="{SITE_BASE}/">Analyze your article →</a>
  </div>
</main>
</body>
</html>"""
```

(Note: this implementation covers everything the tests check. We'll extend it in later tasks if needed — the spec also calls for accordions and "broaden your view" sections, which are additive and will be added in Task 4b below.)

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/share.py backend/tests/test_share.py
git commit -m "feat(backend): share-page HTML rendering with OG meta tags"
```

---

### Task 4b: Extend `render_share_html` with accordions and broaden-your-view

**Files:**
- Modify: `backend/share.py`
- Modify: `backend/tests/test_share.py`

The basic share page from Task 4 has the scores + summary + CTA. The spec requires three collapsible accordions (biased phrases, fact-check breakdown, sources cited) and a Broaden Your View grid.

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_share.py`:

```python
def test_render_share_html_renders_framing_choices_accordion():
    from share import render_share_html
    a = dict(SAMPLE_ANALYSIS)
    a["result_json"] = dict(SAMPLE_ANALYSIS["result_json"])
    a["result_json"]["political_lean"] = dict(a["result_json"]["political_lean"])
    a["result_json"]["political_lean"]["framing_choices"] = [
        {"quote": "outrageous decision", "analysis": "Loaded language.", "lean": "left"},
    ]
    html = render_share_html(a)
    assert "Framing" in html
    assert "outrageous decision" in html


def test_render_share_html_renders_fact_claims_accordion():
    from share import render_share_html
    a = dict(SAMPLE_ANALYSIS)
    a["result_json"] = dict(SAMPLE_ANALYSIS["result_json"])
    a["result_json"]["fact_check"] = {
        "score": 80,
        "claims": [{"claim": "X says Y", "verdict": "supported", "explanation": "Confirmed."}],
    }
    html = render_share_html(a)
    assert "Fact-check" in html
    assert "X says Y" in html


def test_render_share_html_renders_broaden_your_view():
    from share import render_share_html
    a = dict(SAMPLE_ANALYSIS)
    a["result_json"] = dict(SAMPLE_ANALYSIS["result_json"])
    a["result_json"]["broaden_your_view"] = [
        {"outlet": "NYT", "perspective": "liberal", "angle": "Voter access concerns", "why": "Detail on impact."},
        {"outlet": "WSJ", "perspective": "conservative", "angle": "Conservative legal case", "why": "Procedural detail."},
    ]
    html = render_share_html(a)
    assert "Broaden your view" in html
    assert "NYT" in html
    assert "WSJ" in html
    assert "Voter access concerns" in html
    assert "google.com/search" in html


def test_render_share_html_omits_empty_accordions():
    from share import render_share_html
    a = dict(SAMPLE_ANALYSIS)
    a["result_json"] = dict(SAMPLE_ANALYSIS["result_json"])
    a["result_json"]["political_lean"] = dict(a["result_json"]["political_lean"])
    a["result_json"]["political_lean"]["framing_choices"] = []
    a["result_json"]["fact_check"] = {"score": 0, "claims": []}
    a["result_json"]["broaden_your_view"] = []
    html = render_share_html(a)
    assert "Framing" not in html
    assert "Fact-check" not in html
    assert "Broaden your view" not in html
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: the four new tests fail; the original seven still pass.

- [ ] **Step 3: Implement accordions + broaden-your-view in `backend/share.py`**

In `backend/share.py`, add these helpers above `render_share_html` (just below the colour helpers):

```python
from urllib.parse import quote_plus


def _accordion(title: str, body_html: str) -> str:
    return f"""<details class="acc">
  <summary><span class="acc-title">{_esc(title)}</span><span class="acc-icon">›</span></summary>
  <div class="acc-body">{body_html}</div>
</details>"""


def _framing_choices_section(political_lean: dict) -> str:
    """Render the 'framing choices' accordion (quotes that reveal bias)."""
    items = (political_lean or {}).get("framing_choices") or []
    if not items:
        return ""
    body = "".join(
        f'<li><b>"{_esc(c.get("quote"))}"</b><br><span class="verdict">{_esc(c.get("analysis") or "")}</span></li>'
        for c in items
    )
    return _accordion(f"Framing choices ({len(items)})", f"<ul>{body}</ul>")


def _fact_claims_section(fact_check: dict) -> str:
    claims = (fact_check or {}).get("claims") or []
    if not claims:
        return ""
    items = "".join(
        f'<li>{_esc(c.get("claim"))} <span class="verdict">— {_esc(c.get("verdict") or "")}</span><br>'
        f'<span class="verdict">{_esc(c.get("explanation") or "")}</span></li>'
        for c in claims
    )
    return _accordion(f"Fact-check breakdown ({len(claims)} claims)", f"<ul>{items}</ul>")


def _broaden_view_section(items: list) -> str:
    """`items` follows the analyzer's broaden_your_view shape: outlet, perspective, angle, why."""
    if not items:
        return ""
    cards = []
    for it in items:
        outlet = _esc(it.get("outlet") or "")
        perspective = _esc(it.get("perspective") or "")
        angle = _esc(it.get("angle") or "")
        why = _esc(it.get("why") or "")
        query = quote_plus(f"{it.get('outlet') or ''} {it.get('angle') or ''}".strip())
        href = f"https://www.google.com/search?q={query}"
        cards.append(
            f'<div class="broaden-card">'
            f'<div class="broaden-tag">{perspective}</div>'
            f'<div class="broaden-outlet">{outlet}</div>'
            f'<div class="broaden-angle">{angle}</div>'
            f'<div class="broaden-why">{why}</div>'
            f'<a class="broaden-link" href="{href}" target="_blank" rel="noopener noreferrer">Search Google ↗</a>'
            f'</div>'
        )
    return f"""<section class="broaden">
  <h2 class="broaden-heading">Broaden your view</h2>
  <div class="broaden-sub">Other perspectives on this story</div>
  <div class="broaden-grid">{''.join(cards)}</div>
</section>"""
```

Then, in `render_share_html`, right after the `result = analysis.get("result_json") or {}` line and before the return statement, compute the sections:

```python
    framing_html = _framing_choices_section(result.get("political_lean") or {})
    fact_html = _fact_claims_section(result.get("fact_check") or {})
    broaden_html = _broaden_view_section(result.get("broaden_your_view") or [])
```

And then in the template literal, replace the section between `</section>` (the summary closing) and `<div class="footer-cta">` with:

```html
  </section>
  {framing_html}
  {fact_html}
  {broaden_html}
  <div class="footer-cta">
```

Add accordion + broaden styles to the `<style>` block (append before the closing `</style>`):

```css
  .acc {{ background: var(--card); border: 1px solid var(--card-bd);
    border-radius: 12px; margin-bottom: 10px; overflow: hidden; }}
  .acc summary {{ list-style: none; padding: 16px 22px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; }}
  .acc summary::-webkit-details-marker {{ display: none; }}
  .acc-title {{ font-size: 14px; font-weight: 600; }}
  .acc-icon {{ color: var(--muted); transition: transform .2s; }}
  details[open] .acc-icon {{ transform: rotate(90deg); }}
  .acc-body {{ padding: 0 22px 18px; }}
  .acc-body ul {{ margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.7;
    color: var(--muted-hi); }}
  .acc-body li {{ margin-bottom: 6px; }}
  .verdict {{ color: var(--muted); font-size: 13px; }}
  .broaden {{ margin-top: 36px; }}
  .broaden-heading {{ font-size: 18px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.3px; }}
  .broaden-sub {{ font-size: 13px; color: var(--muted); margin-bottom: 18px; }}
  .broaden-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }}
  .broaden-card {{ padding: 14px 16px; border-radius: 12px;
    background: var(--card); border: 1px solid var(--card-bd);
    display: flex; flex-direction: column; gap: 6px; }}
  .broaden-tag {{ font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
    color: var(--cyan); font-weight: 700; }}
  .broaden-outlet {{ font-size: 14px; font-weight: 600; color: var(--text); }}
  .broaden-angle {{ font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.8); line-height: 1.4; }}
  .broaden-why {{ font-size: 12px; color: var(--muted); line-height: 1.5; }}
  .broaden-link {{ font-size: 11px; color: var(--cyan); text-decoration: none; margin-top: auto; }}
  @media (max-width: 640px) {{
    h1 {{ font-size: 26px; }}
    .scores {{ grid-template-columns: 1fr; }}
    .broaden-grid {{ grid-template-columns: 1fr; }}
    .wrap {{ padding: 32px 20px 48px; }}
  }}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: all 11 tests pass.

- [ ] **Step 5: Eyeball the rendered HTML**

```bash
cd backend && python -c "
from share import render_share_html
import json
a = {
  'id': 'demo-id',
  'url': 'https://www.theguardian.com/x',
  'source_name': 'theguardian.com',
  'headline': 'Demo headline for eyeball test',
  'lean_label': 'Slight Left',
  'lean_numeric': -2,
  'fact_score': 85,
  'shareable': True,
  'result_json': {
    'title': 'Demo headline for eyeball test',
    'political_lean': {'label': 'Slight Left'},
    'sentiment': {'label': 'Positive'},
    'fact_check': {'score': 85, 'claims': [{'claim': 'A factual claim', 'verdict': 'Verifiable'}]},
    'summary': 'A demo summary paragraph.',
    'biased_phrases': [{'phrase': 'outrageous', 'type': 'loaded'}],
    'perspectives': [
      {'tag': 'Left', 'title': 'Left take', 'search_query': 'left take'},
      {'tag': 'Center', 'title': 'Center take', 'search_query': 'center take'},
      {'tag': 'Right', 'title': 'Right take', 'search_query': 'right take'},
    ],
  },
}
open('/tmp/share-preview.html', 'w').write(render_share_html(a))
print('Written to /tmp/share-preview.html')
"
open /tmp/share-preview.html
```

Expected: the page opens in a browser, renders with the dark Veris theme, shows scores + summary + three accordions + broaden-your-view + CTA. Click an accordion — it should expand/collapse.

- [ ] **Step 6: Commit**

```bash
git add backend/share.py backend/tests/test_share.py
git commit -m "feat(backend): accordions + broaden-your-view on share page"
```

---

### Task 5: `render_og_image` — 1200×630 PNG generator

**Files:**
- Modify: `backend/share.py`
- Modify: `backend/tests/test_share.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_share.py`:

```python
def test_render_og_image_returns_png_bytes():
    from share import render_og_image
    png = render_og_image(SAMPLE_ANALYSIS)
    assert isinstance(png, (bytes, bytearray))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_og_image_has_correct_dimensions():
    from share import render_og_image
    from PIL import Image
    png = render_og_image(SAMPLE_ANALYSIS)
    img = Image.open(io.BytesIO(png))
    assert img.size == (1200, 630)


def test_render_og_image_truncates_long_headline():
    from share import render_og_image
    a = dict(SAMPLE_ANALYSIS)
    a["headline"] = "A " * 200  # 400 chars
    # Should not raise even on absurdly long headline.
    png = render_og_image(a)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
```

Also add at the top of `test_share.py`:
```python
import io
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_share.py::test_render_og_image_returns_png_bytes -v
```

Expected: `AttributeError` or `ImportError`.

- [ ] **Step 3: Implement `render_og_image` in `backend/share.py`**

Append to `backend/share.py` (above the public functions, after the colour helpers):

```python
from PIL import Image, ImageDraw, ImageFont

# RGB palette mirrored from frontend/style.css :root tokens.
COLOR_BG = (8, 11, 15)            # #080b0f
COLOR_TEXT = (240, 244, 248)
COLOR_MUTED = (155, 165, 175)
COLOR_CYAN = (34, 211, 238)
COLOR_PURPLE = (168, 85, 247)
COLOR_GREEN = (74, 222, 128)
COLOR_AMBER = (251, 191, 36)
COLOR_RED = (248, 113, 113)
COLOR_CARD_BG = (255, 255, 255, 12)
COLOR_CARD_BD = (255, 255, 255, 26)


def _wrap_text(draw, text: str, font, max_width: int, max_lines: int):
    """Greedy word-wrap; truncate with ellipsis if over max_lines."""
    words = (text or "").split()
    lines: list[str] = []
    current = ""
    for w in words:
        candidate = (current + " " + w).strip() if current else w
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = w
            if len(lines) == max_lines:
                break
    if current and len(lines) < max_lines:
        lines.append(current)

    if len(lines) == max_lines and (lines == [] or len(" ".join(lines)) < len((text or "").strip())):
        # add ellipsis to last line
        last = lines[-1]
        while draw.textlength(last + "…", font=font) > max_width and len(last) > 1:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines


def _color_for_lean(label: Optional[str]):
    if not label:
        return COLOR_CYAN
    lower = label.lower()
    if "right" in lower:
        return COLOR_RED
    if "center" in lower or "balanced" in lower:
        return COLOR_AMBER
    return COLOR_CYAN


def _color_for_tone(label: Optional[str]):
    if not label:
        return COLOR_CYAN
    lower = label.lower()
    if "positive" in lower:
        return COLOR_GREEN
    if "negative" in lower:
        return COLOR_RED
    return COLOR_AMBER


def _color_for_facts(score: Optional[int]):
    if score is None:
        return COLOR_AMBER
    if score >= 70:
        return COLOR_GREEN
    if score >= 40:
        return COLOR_AMBER
    return COLOR_RED


def _draw_radial_glow(img: Image.Image, center, radius, color, alpha):
    """Approximate a radial gradient with a single soft circle pasted via alpha."""
    glow = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 60
    for i in range(steps, 0, -1):
        a = int(alpha * (i / steps) ** 2)
        r = int(radius * (i / steps))
        gd.ellipse(
            [(radius - r, radius - r), (radius + r, radius + r)],
            fill=color + (a,),
        )
    img.alpha_composite(glow, (center[0] - radius, center[1] - radius))


def render_og_image(analysis: dict) -> bytes:
    """Render a 1200x630 PNG suitable for use as an Open Graph image."""
    W, H = 1200, 630
    img = Image.new("RGBA", (W, H), COLOR_BG + (255,))

    # Background glows — cyan top-left, purple bottom-right.
    _draw_radial_glow(img, center=(220, 180), radius=420, color=COLOR_CYAN, alpha=70)
    _draw_radial_glow(img, center=(1000, 540), radius=420, color=COLOR_PURPLE, alpha=55)

    draw = ImageDraw.Draw(img)

    font_brand = ImageFont.truetype(FONT_BOLD, 32)
    font_brand_mark = ImageFont.truetype(FONT_BOLD, 30)
    font_source = ImageFont.truetype(FONT_BOLD, 18)
    font_headline = ImageFont.truetype(FONT_BOLD, 56)
    font_score_label = ImageFont.truetype(FONT_BOLD, 14)
    font_score_value = ImageFont.truetype(FONT_BOLD, 34)

    # Brand block — top left.
    pad_x = 80
    pad_y = 72
    mark_d = 56
    # gradient circle: paste a cyan→purple gradient onto a circular mask.
    mark = Image.new("RGBA", (mark_d, mark_d), (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    md.ellipse([(0, 0), (mark_d, mark_d)], fill=COLOR_CYAN + (255,))
    # Overlay purple from one diagonal for a faux gradient.
    for x in range(mark_d):
        for y in range(mark_d):
            if (x + y) > mark_d * 0.6:
                # blend toward purple
                t = min(1.0, ((x + y) - mark_d * 0.6) / (mark_d * 0.8))
                r = int(COLOR_CYAN[0] * (1 - t) + COLOR_PURPLE[0] * t)
                g = int(COLOR_CYAN[1] * (1 - t) + COLOR_PURPLE[1] * t)
                b = int(COLOR_CYAN[2] * (1 - t) + COLOR_PURPLE[2] * t)
                # only inside circle
                cx, cy = mark_d / 2, mark_d / 2
                if (x - cx) ** 2 + (y - cy) ** 2 <= (mark_d / 2) ** 2:
                    mark.putpixel((x, y), (r, g, b, 255))
    img.alpha_composite(mark, (pad_x, pad_y - 12))
    # Big "V" centred on the mark.
    v_w = draw.textlength("V", font=font_brand_mark)
    draw.text(
        (pad_x + (mark_d - v_w) / 2, pad_y - 10),
        "V",
        font=font_brand_mark,
        fill=(10, 10, 10, 255),
    )
    # Wordmark.
    draw.text((pad_x + mark_d + 16, pad_y), "veris", font=font_brand, fill=COLOR_TEXT + (255,))

    # Source line.
    source_name = (analysis.get("source_name") or "").upper()
    fact_score = analysis.get("fact_score")
    source_text = source_name
    if fact_score is not None:
        source_text = f"{source_name}  ·  {fact_score}/100 FACTS" if source_name else f"{fact_score}/100 FACTS"
    if source_text:
        draw.text((pad_x, pad_y + mark_d + 32), source_text, font=font_source, fill=COLOR_MUTED + (255,))

    # Headline — wrap to up to 3 lines.
    headline = analysis.get("headline") or analysis.get("url") or "Veris analysis"
    headline_y = pad_y + mark_d + 70
    headline_lines = _wrap_text(draw, headline, font_headline, max_width=W - pad_x * 2, max_lines=3)
    line_h = 64
    for i, line in enumerate(headline_lines):
        draw.text((pad_x, headline_y + i * line_h), line, font=font_headline, fill=COLOR_TEXT + (255,))

    # Score row — bottom.
    card_h = 110
    card_y = H - pad_y - card_h
    card_w = (W - pad_x * 2 - 36) // 3  # 18px gap × 2
    cards = [
        ("LEAN", analysis.get("lean_label") or "—", _color_for_lean(analysis.get("lean_label"))),
        (
            "TONE",
            ((analysis.get("result_json") or {}).get("sentiment") or {}).get("label") or "—",
            _color_for_tone(((analysis.get("result_json") or {}).get("sentiment") or {}).get("label")),
        ),
        (
            "FACTS",
            f"{fact_score}/100" if fact_score is not None else "—",
            _color_for_facts(fact_score),
        ),
    ]
    for i, (label, value, color) in enumerate(cards):
        x0 = pad_x + i * (card_w + 18)
        x1 = x0 + card_w
        y0 = card_y
        y1 = card_y + card_h
        # Card background (semi-transparent white) and tinted border.
        draw.rounded_rectangle(
            [(x0, y0), (x1, y1)],
            radius=16,
            fill=(255, 255, 255, 12),
            outline=color + (115,),
            width=2,
        )
        draw.text((x0 + 24, y0 + 22), label, font=font_score_label, fill=COLOR_MUTED + (255,))
        # Truncate value if too wide for card.
        max_value_w = card_w - 48
        value_disp = value
        while draw.textlength(value_disp, font=font_score_value) > max_value_w and len(value_disp) > 1:
            value_disp = value_disp[:-1]
        if value_disp != value:
            value_disp = value_disp[:-1] + "…"
        draw.text((x0 + 24, y0 + 50), value_disp, font=font_score_value, fill=color + (255,))

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: all 14 tests pass.

- [ ] **Step 5: Eyeball the rendered PNG**

```bash
cd backend && python -c "
from share import render_og_image
a = {
  'id': 'demo',
  'headline': \"Supreme Court's Voting Rights Decision: Law Meets Politics in a Pivotal Ruling\",
  'source_name': 'theguardian.com',
  'lean_label': 'Slight Left',
  'fact_score': 85,
  'result_json': {'sentiment': {'label': 'Positive'}},
}
open('/tmp/og-preview.png', 'wb').write(render_og_image(a))
print('Written /tmp/og-preview.png')
"
open /tmp/og-preview.png
```

Expected: a 1200×630 PNG opens in Preview, showing the dark background, cyan/purple glow, brand mark, source line, wrapped headline, and three coloured score cards.

If the gradient on the brand mark looks janky (pixelated), that's fine for v1 — social platforms display it at small sizes.

- [ ] **Step 6: Commit**

```bash
git add backend/share.py backend/tests/test_share.py
git commit -m "feat(backend): render 1200x630 Open Graph PNG with Pillow"
```

---

### Task 6: `get_or_create_og_png` — Supabase Storage cache

**Files:**
- Modify: `backend/share.py`
- Modify: `backend/tests/test_share.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_share.py`:

```python
def test_get_or_create_og_png_returns_existing_url(mocker):
    """When the file already exists in storage, do NOT call Pillow."""
    mock_storage = MagicMock()
    mock_storage.list.return_value = [{"name": "11111111-2222-3333-4444-555555555555.png"}]
    mock_storage.get_public_url.return_value = "https://supabase/og-cards/abc.png"
    mock_sb = MagicMock()
    mock_sb.storage.from_.return_value = mock_storage

    render_spy = mocker.patch("share.render_og_image")

    from share import get_or_create_og_png
    url = get_or_create_og_png(SAMPLE_ANALYSIS, supabase=mock_sb)

    assert url == "https://supabase/og-cards/abc.png"
    render_spy.assert_not_called()
    mock_storage.upload.assert_not_called()


def test_get_or_create_og_png_creates_when_missing(mocker):
    """When the file is absent, render via Pillow and upload."""
    mock_storage = MagicMock()
    mock_storage.list.return_value = []  # no files
    mock_storage.get_public_url.return_value = "https://supabase/og-cards/new.png"
    mock_sb = MagicMock()
    mock_sb.storage.from_.return_value = mock_storage

    mocker.patch("share.render_og_image", return_value=b"\x89PNG\r\n\x1a\nFAKE")

    from share import get_or_create_og_png
    url = get_or_create_og_png(SAMPLE_ANALYSIS, supabase=mock_sb)

    assert url == "https://supabase/og-cards/new.png"
    mock_storage.upload.assert_called_once()
    call = mock_storage.upload.call_args
    assert call.kwargs.get("path") or call.args[0] == f"{SAMPLE_ANALYSIS['id']}.png"


def test_get_or_create_og_png_upload_failure_returns_none(mocker):
    """Storage upload errors shouldn't crash the route — return None and let the caller fall back."""
    mock_storage = MagicMock()
    mock_storage.list.return_value = []
    mock_storage.upload.side_effect = Exception("storage down")
    mock_sb = MagicMock()
    mock_sb.storage.from_.return_value = mock_storage
    mocker.patch("share.render_og_image", return_value=b"\x89PNG\r\n\x1a\nFAKE")

    from share import get_or_create_og_png
    url = get_or_create_og_png(SAMPLE_ANALYSIS, supabase=mock_sb)

    assert url is None
```

Also at the top of `test_share.py`, ensure these imports are present:

```python
from unittest.mock import MagicMock, patch
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: the three new tests fail (`AttributeError: get_or_create_og_png`).

- [ ] **Step 3: Implement `get_or_create_og_png` in `backend/share.py`**

Append to `backend/share.py`:

```python
OG_BUCKET = "og-cards"


def get_or_create_og_png(analysis: dict, supabase) -> Optional[str]:
    """Return the public URL of the OG PNG for this analysis, generating it if needed.

    Returns None on storage failure so the caller can serve a fallback inline.
    """
    analysis_id = analysis["id"]
    path = f"{analysis_id}.png"
    bucket = supabase.storage.from_(OG_BUCKET)

    # Cache check: list with the exact filename. Storage `list` accepts a search prefix;
    # for an exact match we look for the file name in the bucket root.
    try:
        existing = bucket.list(path="", search=path)
        if existing and any(item.get("name") == path for item in existing):
            return bucket.get_public_url(path)
    except Exception as exc:
        logger.warning("og-cards list failed for %s: %s", path, exc)

    # Miss → render + upload.
    try:
        png = render_og_image(analysis)
    except Exception as exc:
        logger.error("render_og_image failed for %s: %s", analysis_id, exc)
        return None

    try:
        bucket.upload(
            path=path,
            file=png,
            file_options={"content-type": "image/png", "cache-control": "public, max-age=31536000, immutable"},
        )
    except Exception as exc:
        logger.error("og-cards upload failed for %s: %s", path, exc)
        return None

    try:
        return bucket.get_public_url(path)
    except Exception as exc:
        logger.error("og-cards public_url failed for %s: %s", path, exc)
        return None
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_share.py -v
```

Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/share.py backend/tests/test_share.py
git commit -m "feat(backend): cache OG PNGs in Supabase Storage with lazy render"
```

---

## Phase 3 — DB helpers + HTTP routes

### Task 7: `get_public_analysis` and `set_shareable` in `db.py`

**Files:**
- Modify: `backend/db.py`
- Modify: `backend/tests/test_db.py`

- [ ] **Step 1: Add failing tests to `backend/tests/test_db.py`**

Append:

```python
def test_get_public_analysis_returns_row_when_shareable(mocker):
    mock_sb = mocker.patch("db._supabase")
    row = {"id": "abc", "shareable": True, "headline": "x"}
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = row
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result == row


def test_get_public_analysis_returns_none_when_not_shareable(mocker):
    mock_sb = mocker.patch("db._supabase")
    # No row matches when shareable=true is added to the filter.
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result is None


def test_get_public_analysis_returns_none_on_error(mocker):
    mock_sb = mocker.patch("db._supabase")
    mock_sb.table.side_effect = Exception("db down")
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result is None


def test_set_shareable_true(mocker):
    mock_sb = mocker.patch("db._supabase")
    from db import set_shareable
    set_shareable(analysis_id="abc", user_id="u1", shareable=False)
    # eq().eq().update() — order doesn't matter for the test, but make sure
    # the user_id and analysis_id are both used as filters.
    table_call = mock_sb.table.return_value
    assert table_call.update.called
    update_payload = table_call.update.call_args.args[0]
    assert update_payload == {"shareable": False}
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_db.py -v
```

Expected: the four new tests fail with `ImportError` on `get_public_analysis` and `set_shareable`.

- [ ] **Step 3: Implement in `backend/db.py`**

Append (after `delete_user`):

```python
def get_public_analysis(*, analysis_id: str) -> Optional[dict]:
    """Fetch an analysis by id without checking user. Honors shareable=true gate.

    Returns None if not found, not shareable, or on error.
    """
    try:
        res = (
            _supabase.table("analyses")
            .select("*")
            .eq("id", analysis_id)
            .eq("shareable", True)
            .maybe_single()
            .execute()
        )
        return res.data
    except Exception as exc:
        logger.error("get_public_analysis(%s) failed: %s", analysis_id, exc)
        return None


def set_shareable(*, analysis_id: str, user_id: str, shareable: bool) -> bool:
    """Toggle the shareable flag on an analysis the user owns.

    Returns True on success, False otherwise. Filtered by both analysis_id and
    user_id so a user can't toggle someone else's row.
    """
    try:
        _supabase.table("analyses").update({"shareable": shareable}).eq("id", analysis_id).eq("user_id", user_id).execute()
        return True
    except Exception as exc:
        logger.error("set_shareable(%s) failed: %s", analysis_id, exc)
        return False
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_db.py -v
```

Expected: all db tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_db.py
git commit -m "feat(backend): db helpers for public analysis lookup + shareable toggle"
```

---

### Task 8: `GET /a/{id}` route

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/tests/test_routes.py`

- [ ] **Step 1: Add failing tests to `backend/tests/test_routes.py`**

Append:

```python
def test_get_share_page_returns_html(client):
    sample = {
        "id": "abc-123",
        "url": "https://example.com",
        "source_name": "example.com",
        "headline": "Test headline",
        "lean_label": "Center",
        "lean_numeric": 0,
        "fact_score": 70,
        "shareable": True,
        "result_json": {
            "title": "Test headline",
            "political_lean": {"label": "Center"},
            "sentiment": {"label": "Neutral"},
            "fact_check": {"score": 70, "claims": []},
            "summary": "A neutral piece.",
            "biased_phrases": [],
            "perspectives": [],
        },
    }
    with patch("main.get_public_analysis", return_value=sample):
        resp = client.get("/a/abc-123")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "Test headline" in resp.text
    assert 'property="og:image"' in resp.text


def test_get_share_page_404_when_missing(client):
    with patch("main.get_public_analysis", return_value=None):
        resp = client.get("/a/does-not-exist")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("text/html")


def test_get_share_page_sends_noindex(client):
    sample = {
        "id": "abc", "url": None, "source_name": None,
        "headline": "h", "lean_label": "Center", "lean_numeric": 0,
        "fact_score": 50, "shareable": True,
        "result_json": {"sentiment": {"label": "Neutral"}, "fact_check": {"score": 50}},
    }
    with patch("main.get_public_analysis", return_value=sample):
        resp = client.get("/a/abc")
    assert 'content="noindex, nofollow"' in resp.text
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_routes.py -v -k share_page
```

Expected: three failures with 404 or `AttributeError`.

- [ ] **Step 3: Implement the route in `backend/main.py`**

Add the import near the top (with other `from X import Y` lines):

```python
from fastapi.responses import HTMLResponse, RedirectResponse
from db import save_analysis, get_history, get_analysis, delete_user as db_delete_user, find_cached_analysis, get_public_analysis
from share import render_share_html, get_or_create_og_png, render_og_image
```

(Replace the existing `from db import ...` line.)

Add a new HTML constant near the top of the file (after the logging setup, before `MIN_TEXT_LENGTH`):

```python
SHARE_404_HTML = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Analysis not found — Veris</title>
<style>
  body{margin:0;background:#080b0f;color:#f0f4f8;font-family:'DM Sans',sans-serif;
       display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center}
  h1{font-size:28px;margin:0 0 12px}
  p{color:rgba(255,255,255,0.6);margin:0 0 24px;font-size:15px}
  a{color:#22d3ee;text-decoration:none;font-weight:600}
</style>
</head><body>
<div>
  <h1>This analysis isn't available.</h1>
  <p>It may have been deleted, or the link is wrong.</p>
  <a href="https://veris.news/">← Back to Veris</a>
</div>
</body></html>"""
```

Add the route handler (place it before the `/analyze` route for readability):

```python
@app.get("/a/{analysis_id}", tags=["share"])
async def share_page(analysis_id: str):
    """Public, no-auth share page for a single analysis."""
    row = get_public_analysis(analysis_id=analysis_id)
    if not row:
        return HTMLResponse(content=SHARE_404_HTML, status_code=404)
    return HTMLResponse(content=render_share_html(row), status_code=200)
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_routes.py -v
```

Expected: all tests pass (the three new share tests + all prior tests).

- [ ] **Step 5: Smoke-test locally**

```bash
cd backend && uvicorn main:app --reload --port 8000 &
sleep 3
curl -i http://localhost:8000/a/does-not-exist | head -20
```

Expected: HTTP 404 with the HTML 404 page in the body.

Kill the server: `kill %1`.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_routes.py
git commit -m "feat(backend): GET /a/{id} returns public share-page HTML"
```

---

### Task 9: `GET /og/{id}.png` route

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/tests/test_routes.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_routes.py`:

```python
def test_get_og_image_redirects_to_storage(client):
    sample = {
        "id": "abc-123", "headline": "H", "shareable": True,
        "url": None, "source_name": None, "lean_label": "Center", "lean_numeric": 0,
        "fact_score": 70,
        "result_json": {"sentiment": {"label": "Neutral"}, "fact_check": {"score": 70}},
    }
    with patch("main.get_public_analysis", return_value=sample), \
         patch("main.get_or_create_og_png", return_value="https://supabase/og-cards/abc-123.png"):
        resp = client.get("/og/abc-123.png", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://supabase/og-cards/abc-123.png"


def test_get_og_image_404_when_missing(client):
    with patch("main.get_public_analysis", return_value=None):
        resp = client.get("/og/does-not-exist.png", follow_redirects=False)
    assert resp.status_code == 404


def test_get_og_image_inline_fallback_on_storage_failure(client):
    sample = {
        "id": "abc", "headline": "H", "shareable": True,
        "url": None, "source_name": None, "lean_label": "Center", "lean_numeric": 0,
        "fact_score": 70,
        "result_json": {"sentiment": {"label": "Neutral"}, "fact_check": {"score": 70}},
    }
    with patch("main.get_public_analysis", return_value=sample), \
         patch("main.get_or_create_og_png", return_value=None), \
         patch("main.render_og_image", return_value=b"\x89PNG\r\n\x1a\nFAKE"):
        resp = client.get("/og/abc.png", follow_redirects=False)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content.startswith(b"\x89PNG")
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_routes.py -v -k og_image
```

Expected: three failures (404 from FastAPI default).

- [ ] **Step 3: Implement the route in `backend/main.py`**

Add this import near the top:

```python
from fastapi.responses import Response  # alongside HTMLResponse, RedirectResponse
```

Add a module-level Supabase client reference (it's already initialised in `db.py`; we re-import for clarity):

```python
from db import _supabase as supabase_client  # used for storage access
```

Place this right after `share_page`:

```python
@app.get("/og/{analysis_id}.png", tags=["share"])
async def og_image(analysis_id: str):
    """Open Graph image for a share page. 302 to Supabase Storage on hit;
    inline PNG fallback if storage upload fails."""
    row = get_public_analysis(analysis_id=analysis_id)
    if not row:
        # Return a 1x1 transparent PNG with 404 status to avoid social platforms
        # caching broken images. Simpler: just 404.
        return Response(status_code=404)
    url = get_or_create_og_png(row, supabase=supabase_client)
    if url:
        return RedirectResponse(
            url=url,
            status_code=302,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    # Storage failed — render inline.
    try:
        png = render_og_image(row)
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})
    except Exception as exc:
        logger.error("og inline render failed for %s: %s", analysis_id, exc)
        return Response(status_code=500)
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_routes.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_routes.py
git commit -m "feat(backend): GET /og/{id}.png with Storage cache + inline fallback"
```

---

### Task 10: Return `analysis_id` from `/analyze`

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/tests/test_routes.py`

The frontend needs the saved analysis row's id to render the Share row. Today `/analyze` returns the analysis result but not the row id.

- [ ] **Step 1: Add a failing test**

Append to `backend/tests/test_routes.py`:

```python
def test_analyze_returns_analysis_id_when_signed_in(client):
    fake_result = {
        "title": "X",
        "political_lean": {"label": "Center", "numeric": 0},
        "sentiment": {"label": "Neutral", "numeric": 0},
        "fact_check": {"score": 50, "claims": []},
    }
    with patch("main.verify_jwt", return_value={"id": "u1", "email": "a@b.com"}), \
         patch("main.get_quota", return_value=MagicMock(used=0, limit=10, tier="free", allowed=True)), \
         patch("main.analyze_content", return_value=fake_result), \
         patch("main.find_cached_analysis", return_value=None), \
         patch("main.save_analysis", return_value="row-id-xyz"):
        resp = client.post(
            "/analyze",
            json={"text": "x" * 100},
            headers={"Authorization": "Bearer t"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["analysis_id"] == "row-id-xyz"


def test_analyze_anonymous_response_omits_analysis_id(client):
    fake_result = {
        "title": "X",
        "political_lean": {"label": "Center", "numeric": 0},
        "sentiment": {"label": "Neutral", "numeric": 0},
        "fact_check": {"score": 50, "claims": []},
    }
    with patch("main.analyze_content", return_value=fake_result), \
         patch("main.find_cached_analysis", return_value=None):
        resp = client.post(
            "/analyze",
            json={"text": "x" * 100},
            headers={"origin": "chrome-extension://abc"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("analysis_id") is None
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd backend && python -m pytest tests/test_routes.py -v -k "analyze_returns_analysis_id or analyze_anonymous_response_omits"
```

Expected: the signed-in test fails (`analysis_id` not in response).

- [ ] **Step 3: Update the `/analyze` route**

In `backend/main.py`, find the block in `analyze()` that calls `save_analysis` (around line 374 — the `await loop.run_in_executor(None, lambda: save_analysis(...))`). Capture the return value and propagate.

Replace the existing save block:

```python
    if user:
        lean = result.get("political_lean", {})
        fc = result.get("fact_check", {})
        derived_source = None
        if source_url:
            try:
                from urllib.parse import urlparse
                derived_source = urlparse(source_url).hostname
                if derived_source and derived_source.startswith("www."):
                    derived_source = derived_source[4:]
            except Exception:
                pass
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: save_analysis(
            user_id=user["id"],
            url=source_url,
            source_name=derived_source,
            headline=result.get("title"),
            lean_label=lean.get("label"),
            lean_numeric=lean.get("numeric"),
            fact_score=fc.get("score"),
            result_json=result,
            article_text=article_text[:5000],
            content_hash=content_hash,
        ))
```

with:

```python
    saved_id: Optional[str] = None
    if user:
        lean = result.get("political_lean", {})
        fc = result.get("fact_check", {})
        derived_source = None
        if source_url:
            try:
                from urllib.parse import urlparse
                derived_source = urlparse(source_url).hostname
                if derived_source and derived_source.startswith("www."):
                    derived_source = derived_source[4:]
            except Exception:
                pass
        loop = asyncio.get_event_loop()
        saved_id = await loop.run_in_executor(None, lambda: save_analysis(
            user_id=user["id"],
            url=source_url,
            source_name=derived_source,
            headline=result.get("title"),
            lean_label=lean.get("label"),
            lean_numeric=lean.get("numeric"),
            fact_score=fc.get("score"),
            result_json=result,
            article_text=article_text[:5000],
            content_hash=content_hash,
        ))
```

Then update the response a few lines below. Find:

```python
    response = JSONResponse(content={"success": True, "data": result, "source_url": source_url, "text_preview": preview, "cached": cached})
```

Replace with:

```python
    response = JSONResponse(content={
        "success": True,
        "data": result,
        "source_url": source_url,
        "text_preview": preview,
        "cached": cached,
        "analysis_id": saved_id,
    })
```

Also update the `AnalyzeResponse` Pydantic model. Find its definition (around line 79):

```python
class AnalyzeResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    source_url: Optional[str] = None
    text_preview: Optional[str] = None
```

Replace it with:

```python
class AnalyzeResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    source_url: Optional[str] = None
    text_preview: Optional[str] = None
    analysis_id: Optional[str] = None
    cached: Optional[bool] = None
```

(`cached` was already in the response body but missing from the model — we're tightening it while we're here.)

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd backend && python -m pytest tests/test_routes.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_routes.py
git commit -m "feat(backend): return analysis_id from /analyze for share URLs"
```

---

## Phase 4 — Cloudflare routing

### Task 11: `frontend/_redirects` for `/a/*` and `/og/*`

**Files:**
- Create: `frontend/_redirects`

Cloudflare Pages reads a `_redirects` file at the root of the deployment and applies its rules at the edge. Status `200` makes Cloudflare *rewrite* (proxy) instead of `302`/`301` redirect — the browser/crawler stays on `veris.news`.

- [ ] **Step 1: Create the file**

```
/a/*    https://media-bias-analyzer-production.up.railway.app/a/:splat    200
/og/*   https://media-bias-analyzer-production.up.railway.app/og/:splat   200
```

Save as `frontend/_redirects` (no extension, no leading slash in the file name).

- [ ] **Step 2: Verify the file is in the Cloudflare Pages deployment directory**

```bash
ls -la frontend/_redirects
```

Expected: file is ~180 bytes, exists in the same directory as `index.html`.

- [ ] **Step 3: Commit and deploy**

```bash
git add frontend/_redirects
git commit -m "feat(frontend): proxy /a/* and /og/* to Railway via Cloudflare _redirects"
```

(The deploy to Cloudflare Pages happens on push to main via existing CI; merge is in the rollout step at the end of the plan.)

- [ ] **Step 4: After deploy, verify the rewrite works**

(Skip this step now — it can only be done after Phase 5 merges to main and Cloudflare picks up the file. Recorded here as the verification step.)

```bash
# To run AFTER the rollout merge:
curl -i https://veris.news/a/does-not-exist | head -5
```

Expected (after rollout): HTTP/2 404 with HTML 404 page body. If you see Cloudflare's generic 404 page, the `_redirects` file didn't deploy — check the Pages deployment logs.

---

## Phase 5 — Frontend share buttons

### Task 12: Share helper module `frontend/share.js`

**Files:**
- Create: `frontend/share.js`

A small, exportless module attached to `window.VerisShare` so both `script.js` and `history.js` can use it.

- [ ] **Step 1: Create `frontend/share.js`**

```javascript
// frontend/share.js — share-link helpers shared by results page and history.
// Attaches to window.VerisShare. No build step; loaded via <script src="share.js">.

(function () {
  const SITE = "https://veris.news";

  function buildShareUrl(analysisId) {
    return `${SITE}/a/${analysisId}`;
  }

  function buildShareText(headline, leanLabel, factScore) {
    const lean = leanLabel || "—";
    const facts = factScore != null ? `${factScore}/100` : "—";
    return `"${headline || "Article"}" — analysed on Veris. Lean: ${lean}, Facts: ${facts}.`;
  }

  function openShareIntent(platform, headline, leanLabel, factScore, shareUrl) {
    const text = buildShareText(headline, leanLabel, factScore);
    const encodedText = encodeURIComponent(text);
    const encodedUrl = encodeURIComponent(shareUrl);
    let target = null;
    switch (platform) {
      case "x":
        target = `https://x.com/intent/post?text=${encodedText}&url=${encodedUrl}`;
        break;
      case "linkedin":
        target = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
        break;
      case "whatsapp":
        target = `https://wa.me/?text=${encodedText}%20${encodedUrl}`;
        break;
      default:
        return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  }

  async function copyShareLink(shareUrl) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    } catch (_) {
      // Fallback: temp textarea.
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  function renderShareRow(container, analysisId, headline, leanLabel, factScore, onCopy) {
    const shareUrl = buildShareUrl(analysisId);
    container.innerHTML = `
      <span class="share-row-label">Share this analysis:</span>
      <button class="share-btn" data-platform="x"        title="Share on X">𝕏</button>
      <button class="share-btn" data-platform="linkedin" title="Share on LinkedIn">in</button>
      <button class="share-btn" data-platform="whatsapp" title="Share on WhatsApp">✆</button>
      <button class="share-btn copy" data-platform="copy">⎘ Copy link</button>
    `;
    container.querySelectorAll(".share-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const platform = btn.dataset.platform;
        if (platform === "copy") {
          const ok = await copyShareLink(shareUrl);
          if (typeof onCopy === "function") onCopy(ok);
        } else {
          openShareIntent(platform, headline, leanLabel, factScore, shareUrl);
        }
      });
    });
  }

  window.VerisShare = {
    buildShareUrl,
    buildShareText,
    openShareIntent,
    copyShareLink,
    renderShareRow,
  };
})();
```

- [ ] **Step 2: Smoke-test in browser console**

Open `frontend/index.html` locally (or any page that loads `share.js`):

```js
VerisShare.buildShareUrl("abc-123");
// → "https://veris.news/a/abc-123"
VerisShare.buildShareText("Test", "Slight Left", 85);
// → "\"Test\" — analysed on Veris. Lean: Slight Left, Facts: 85/100."
```

Expected: both calls return the strings above. (You don't have a way to test `openShareIntent` without opening real tabs — skip; we'll verify end-to-end.)

- [ ] **Step 3: Commit**

```bash
git add frontend/share.js
git commit -m "feat(frontend): share-link helpers for intent URLs + clipboard"
```

---

### Task 13: Share row on the website results page

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/script.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Load `share.js` in `frontend/index.html`**

Find the existing `<script src="auth.js"></script>` line (or wherever the other JS files are loaded near the bottom of `<body>`). Add this line above `<script src="script.js"></script>`:

```html
<script src="share.js"></script>
```

- [ ] **Step 2: Add `.share-row` styles to `frontend/style.css`**

Append to the file:

```css
.share-row {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--card-bd);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.share-row-label {
  font-size: 13px;
  color: var(--muted);
  margin-right: 4px;
}
.share-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--card);
  border: 1px solid var(--card-bd);
  color: var(--muted-hi);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
  font-size: 14px;
  padding: 0;
}
.share-btn:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text);
}
.share-btn.copy {
  width: auto;
  padding: 0 14px;
  display: flex;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}
.share-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text);
  color: var(--bg);
  padding: 12px 20px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  z-index: 9999;
  animation: shareToastIn 0.2s ease-out;
}
@keyframes shareToastIn {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
```

- [ ] **Step 3: Render the share row after a successful analysis in `frontend/script.js`**

In `frontend/script.js`, find the `renderResults(payload)` function. It looks like this (around line 187):

```javascript
function renderResults(payload) {
  const data = payload.data;
  if (!data) { showError("No analysis data returned."); return; }

  renderResultsHeader(data, payload.source_url);
  renderScoreCards(data);
  renderSummaryCard(data);
  renderPoliticalLean(data.political_lean);
  renderSentiment(data.sentiment);
  renderFactCheck(data.fact_check);
  renderBroadenSection(data.broaden_your_view);

  const savedEl = document.getElementById('saved-indicator');
  const loggedIn = typeof getSession === 'function' && getSession();
  if (savedEl) savedEl.hidden = !loggedIn;

  const hero = document.querySelector('.hero');
  if (hero) hero.style.display = 'none';
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}
```

After the `if (savedEl) savedEl.hidden = !loggedIn;` line, insert this block:

```javascript
  // Share row — signed-in users only (we need a saved analysis_id from /analyze).
  const analysisId = payload.analysis_id;
  if (analysisId && resultsSection && window.VerisShare) {
    resultsSection.querySelectorAll('.share-row').forEach((n) => n.remove());
    const row = document.createElement('div');
    row.className = 'share-row';
    resultsSection.appendChild(row);
    window.VerisShare.renderShareRow(
      row,
      analysisId,
      data.title || '',
      data.political_lean?.label || '',
      data.fact_check?.score,
      (ok) => showShareToast(ok ? 'Link copied to clipboard' : 'Could not copy'),
    );
  }
```

Also add the `showShareToast` helper at the bottom of `script.js`:

```javascript
function showShareToast(text) {
  document.querySelectorAll('.share-toast').forEach((n) => n.remove());
  const t = document.createElement('div');
  t.className = 'share-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
```

- [ ] **Step 4: Smoke-test in the browser**

Serve the frontend locally (e.g. `cd frontend && python -m http.server 8080`). Open `http://localhost:8080`. Sign in. Paste a URL, click Analyze. After the result renders:

- The share row should appear at the bottom of the results section.
- Clicking "Copy link" should copy `https://veris.news/a/{id}` and show the toast "Link copied to clipboard".
- Clicking X / LinkedIn / WhatsApp should open a new tab with the platform's intent URL (the share URL won't be live yet since deploy hasn't happened; that's expected).

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/script.js frontend/style.css
git commit -m "feat(frontend): share row on results page after analysis"
```

---

### Task 14: Share button on the history page

**Files:**
- Modify: `frontend/history.js`
- Modify: `frontend/style.css`

The history page already loads `share.js` (now that `index.html` includes it for the whole site). We add a small per-row share affordance.

- [ ] **Step 1: Add `.share-history-btn` styles to `frontend/style.css`**

Append:

```css
.history-item .share-history-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--card-bd);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-family: inherit;
  font-size: 14px;
  margin-left: 6px;
  transition: background 0.15s, color 0.15s;
}
.history-item .share-history-btn:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text);
}
.share-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #11151b;
  border: 1px solid var(--card-bd);
  border-radius: 12px;
  padding: 10px;
  display: flex;
  gap: 8px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.share-popover .share-btn { width: 32px; height: 32px; }
.share-popover .share-btn.copy { width: auto; padding: 0 12px; }
```

- [ ] **Step 2: Modify `frontend/history.js`**

In `frontend/history.js`, find the block around line 122 where each history item's HTML is set:

```javascript
itemEl.innerHTML = `
  <div class="history-icon" style="background:rgba(34,211,238,0.12)">⊙</div>
  <div class="history-body">
    <div class="history-title">${escapeH(item.headline || item.url || 'Untitled')}</div>
    <div class="history-meta">
      <span>${escapeH(item.source_name || 'Unknown')}</span>
      <span>·</span>
      <span>${timeStr}</span>
    </div>
  </div>
  <div class="history-badges">${leanPill}${factScorePill}</div>
`;
```

Replace it with this version that adds a share button (note the new `<button>` after `.history-badges`):

```javascript
itemEl.innerHTML = `
  <div class="history-icon" style="background:rgba(34,211,238,0.12)">⊙</div>
  <div class="history-body">
    <div class="history-title">${escapeH(item.headline || item.url || 'Untitled')}</div>
    <div class="history-meta">
      <span>${escapeH(item.source_name || 'Unknown')}</span>
      <span>·</span>
      <span>${timeStr}</span>
    </div>
  </div>
  <div class="history-badges">${leanPill}${factScorePill}</div>
  <button class="share-history-btn"
          data-id="${item.id}"
          data-headline="${escapeH(item.headline || '')}"
          data-lean="${escapeH(item.lean_label || '')}"
          data-fact="${item.fact_score ?? ''}"
          title="Share">⤴</button>
`;
```

(The `data-` attributes carry the per-row metadata so we don't need to scrape it back out of the DOM later.)

The existing `itemEl.addEventListener('click', () => openHistoryItem(item.id));` will fire when clicking anywhere in the row — including the share button. We need to stop propagation from the share button. Replace the existing click listener with:

```javascript
itemEl.addEventListener('click', (ev) => {
  if (ev.target.closest('.share-history-btn')) return;  // share clicks handled separately
  openHistoryItem(item.id);
});
```

Then after `list.appendChild(groupDiv);` (around line 137), add the share-button click handler. Place this block at the end of the `groupOrder.forEach(...)` loop (right after `list.appendChild(groupDiv);` line, but still inside `renderItems`):

```javascript
list.querySelectorAll('.share-history-btn').forEach((btn) => {
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    document.querySelectorAll('.share-popover').forEach((p) => p.remove());
    const pop = document.createElement('div');
    pop.className = 'share-popover';
    btn.appendChild(pop);
    const factScore = btn.dataset.fact ? parseInt(btn.dataset.fact, 10) : null;
    window.VerisShare.renderShareRow(
      pop,
      btn.dataset.id,
      btn.dataset.headline,
      btn.dataset.lean,
      factScore,
      (ok) => {
        if (typeof showShareToast === 'function') {
          showShareToast(ok ? 'Link copied to clipboard' : 'Could not copy');
        }
      },
    );
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!pop.contains(e.target)) {
          pop.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  });
});
```

Note: `showShareToast` lives in `script.js` and is global, so it's available here as long as `script.js` is loaded on the same page as `history.js` (it is — both are loaded by `index.html`).

- [ ] **Step 3: Smoke-test**

Reload the history page locally (with a signed-in account that has analyses). Click a share icon on any row. Popover should appear with the four share buttons. Click "Copy link" — toast says "Link copied".

- [ ] **Step 4: Commit**

```bash
git add frontend/history.js frontend/style.css
git commit -m "feat(frontend): share button on each history row"
```

---

## Phase 6 — Chrome extension share row

### Task 15: Share row in extension popup

**Files:**
- Create: `extension/lib/share.js`
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.js`
- Modify: `extension/popup/popup.css`
- Modify: `extension/background/service-worker.js`

The extension is sandboxed — `window.open` works but `chrome.tabs.create` is preferred. We bundle a small extension-flavoured copy of the share helper.

- [ ] **Step 1: Create `extension/lib/share.js`**

```javascript
// extension/lib/share.js — share helpers for the Chrome extension popup.

(function () {
  const SITE = "https://veris.news";

  function buildShareUrl(analysisId) { return `${SITE}/a/${analysisId}`; }

  function buildShareText(headline, leanLabel, factScore) {
    const lean = leanLabel || "—";
    const facts = factScore != null ? `${factScore}/100` : "—";
    return `"${headline || "Article"}" — analysed on Veris. Lean: ${lean}, Facts: ${facts}.`;
  }

  function openShareIntent(platform, headline, leanLabel, factScore, shareUrl) {
    const text = buildShareText(headline, leanLabel, factScore);
    const encodedText = encodeURIComponent(text);
    const encodedUrl = encodeURIComponent(shareUrl);
    let target = null;
    switch (platform) {
      case "x":         target = `https://x.com/intent/post?text=${encodedText}&url=${encodedUrl}`; break;
      case "linkedin":  target = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`; break;
      case "whatsapp":  target = `https://wa.me/?text=${encodedText}%20${encodedUrl}`; break;
      default: return;
    }
    chrome.tabs.create({ url: target });
  }

  async function copyShareLink(shareUrl) {
    try { await navigator.clipboard.writeText(shareUrl); return true; }
    catch (_) { return false; }
  }

  function renderShareRow(container, analysisId, headline, leanLabel, factScore, onCopy) {
    const shareUrl = buildShareUrl(analysisId);
    container.innerHTML = `
      <span class="share-row-label">Share:</span>
      <button class="share-btn" data-platform="x">𝕏</button>
      <button class="share-btn" data-platform="linkedin">in</button>
      <button class="share-btn" data-platform="whatsapp">✆</button>
      <button class="share-btn copy" data-platform="copy">⎘</button>
    `;
    container.querySelectorAll(".share-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const platform = btn.dataset.platform;
        if (platform === "copy") {
          const ok = await copyShareLink(shareUrl);
          if (typeof onCopy === "function") onCopy(ok);
        } else {
          openShareIntent(platform, headline, leanLabel, factScore, shareUrl);
        }
      });
    });
  }

  window.VerisShare = {
    buildShareUrl, buildShareText, openShareIntent, copyShareLink, renderShareRow,
  };
})();
```

- [ ] **Step 2: Load `share.js` in `extension/popup/popup.html`**

Add this line in the `<head>` (or just before `</body>`, wherever other scripts are loaded), just before the existing `<script src="popup.js"></script>`:

```html
<script src="../lib/share.js"></script>
```

- [ ] **Step 3: Add styles to `extension/popup/popup.css`**

Append:

```css
.share-row {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex;
  align-items: center;
  gap: 6px;
}
.share-row-label {
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  margin-right: 2px;
}
.share-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.88);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  padding: 0;
}
.share-btn:hover { background: rgba(255,255,255,0.1); }
.share-toast {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #f0f4f8;
  color: #080b0f;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
```

- [ ] **Step 4: Capture `analysis_id` in the service worker**

`extension/background/service-worker.js` currently stores `{ url, status, result }` per tab — it captures `envelope.data` but drops `envelope.analysis_id`. We need to persist it so the popup can read it back.

Find this block (around line 120):

```javascript
if (envelope.success) {
  state.set(tabId, { url, status: "done", result: envelope.data });
} else {
  console.warn("[Veris bg] analysis failed:", envelope.error);
  state.set(tabId, { url, status: "error", error: envelope.error || "Analysis failed" });
}
```

Replace with:

```javascript
if (envelope.success) {
  state.set(tabId, {
    url,
    status: "done",
    result: envelope.data,
    analysisId: envelope.analysis_id || null,
  });
} else {
  console.warn("[Veris bg] analysis failed:", envelope.error);
  state.set(tabId, { url, status: "error", error: envelope.error || "Analysis failed" });
}
```

(`api.js` returns the full JSON envelope from `/analyze`, so `envelope.analysis_id` is already on the wire after Task 10. No changes needed in `api.js`.)

- [ ] **Step 5: Update popup `renderResults` to accept the analysis_id and render the share row**

In `extension/popup/popup.js`:

a) Change the signature of `renderResults` (around line 232):

```javascript
function renderResults(tab, data) {
```

to:

```javascript
function renderResults(tab, data, analysisId) {
```

b) Update the call site at the bottom of the file (around line 387):

```javascript
else if (resp.status === "done") renderResults(tab, resp.entry.result);
```

to:

```javascript
else if (resp.status === "done") renderResults(tab, resp.entry.result, resp.entry.analysisId);
```

c) Add a `<div id="results-share"></div>` to the results template inside `renderResults`. Find this part of the innerHTML template (around line 332-336):

```javascript
${summary ? `<div class="vp-summary">${escapeHtml(summary)}</div>` : ""}
${broadenHtml}
<div class="vp-cta">
  <button class="vp-cta-primary" id="btn-full">Open full report on Veris ↗</button>
</div>
```

Replace with:

```javascript
${summary ? `<div class="vp-summary">${escapeHtml(summary)}</div>` : ""}
${broadenHtml}
<div id="results-share"></div>
<div class="vp-cta">
  <button class="vp-cta-primary" id="btn-full">Open full report on Veris ↗</button>
</div>
```

d) After the `bindHeader();` call (around line 338), insert the share row population block:

```javascript
  // Share row — signed-in + we have a saved analysis_id.
  if (_session?.user && analysisId && window.VerisShare) {
    const container = document.getElementById('results-share');
    if (container) {
      container.innerHTML = "";
      const row = document.createElement('div');
      row.className = 'share-row';
      container.appendChild(row);
      window.VerisShare.renderShareRow(
        row,
        analysisId,
        title,
        pl.label || '',
        fc.score,
        (ok) => {
          const t = document.createElement('div');
          t.className = 'share-toast';
          t.textContent = ok ? 'Copied' : 'Copy failed';
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 1600);
        },
      );
    }
  }
```

(`title`, `pl`, `fc` are local variables already defined earlier in the same function.)

- [ ] **Step 6: Reload the extension and smoke-test**

In Chrome:
1. `chrome://extensions` → reload the Veris extension.
2. Sign in to Veris from the popup.
3. Analyze any article.
4. Confirm the share row appears just above "Open full report on Veris ↗".
5. Click the Copy button — toast says "Copied". Paste into a tab's address bar to verify the URL is `https://veris.news/a/{id}`.
6. Click LinkedIn / X / WhatsApp — each opens a new tab to the platform with pre-filled content.

- [ ] **Step 7: Commit**

```bash
git add extension/lib/share.js extension/popup/popup.html extension/popup/popup.js extension/popup/popup.css extension/background/service-worker.js
git commit -m "feat(extension): share row in popup results (signed-in users)"
```

---

## Phase 7 — Privacy policy + docs

### Task 16: Update privacy policy

**Files:**
- Modify: `frontend/privacy.html`

- [ ] **Step 1: Add sharing paragraph to `frontend/privacy.html`**

Find the section "If you sign in with Google (optional):" (around line 93). Just below that `<ul>` block, before the next `<p><strong>` section, insert a new subsection:

```html
<p><strong>When you share an analysis:</strong></p>
<ul>
  <li>When signed in, each analysis you run is saved to your account and assigned a unique unguessable ID. By default, anyone with the share link (for example, when you post it on LinkedIn or X) can view that analysis.</li>
  <li>The public share view shows only the article URL, headline, source, scores, and analysis content. It never shows your name, email, or any other account information.</li>
  <li>You can disable sharing for any individual analysis from My History.</li>
</ul>
```

Also update the "Last updated" date at the top from `May 12, 2026` to today (`May 14, 2026`).

- [ ] **Step 2: Eyeball the rendered HTML**

Open `frontend/privacy.html` in a browser, scroll to the new section. Confirm formatting matches the surrounding list style.

- [ ] **Step 3: Commit**

```bash
git add frontend/privacy.html
git commit -m "docs(privacy): disclose share-link behaviour"
```

---

## Phase 8 — End-to-end manual verification

### Task 17: Production smoke checks

**Files:** none (manual).

These checks run AFTER the feature is merged to `main` and Cloudflare + Railway have redeployed.

- [ ] **Step 1: Merge feature branch to main and push**

(Use whatever flow you normally use — likely `git checkout main && git merge feature/share-pages && git push`.)

- [ ] **Step 2: Wait for deploys**

Cloudflare Pages deploy: ~30s. Railway deploy: ~60s.

Verify Railway deploy succeeded: open the Railway dashboard and confirm the new build is "Active".

- [ ] **Step 3: Test `/a/{id}` end-to-end**

Sign in, analyze any article on `veris.news` so a new row is saved. Note the `analysis_id` from the share row (open devtools network tab on `/analyze`, look at the response JSON).

In an incognito tab:

```
https://veris.news/a/{paste-the-id}
```

Expected: full share page renders with no auth. No console errors. Scores + summary + accordions + broaden-your-view + CTA all visible.

- [ ] **Step 4: Test `/og/{id}.png` directly**

```
https://veris.news/og/{paste-the-id}.png
```

Expected: 1200×630 PNG renders (or is downloaded). First request may take 1-2s (Pillow rendering); second request is instant (Storage CDN cache).

- [ ] **Step 5: LinkedIn Post Inspector**

Go to https://www.linkedin.com/post-inspector/ — paste the share URL — click Inspect.

Expected: rich preview with the OG image, headline, and og description. No warnings.

- [ ] **Step 6: Twitter Card Validator**

Go to https://cards-dev.twitter.com/validator — paste the share URL — click Preview Card.

Expected: large-image card preview with the OG image and headline.

> Note: Twitter/X's official validator is sometimes flaky. If it errors, try pasting the link in a tweet draft on x.com — the preview card there is the source of truth.

- [ ] **Step 7: WhatsApp**

Open WhatsApp Web. Send the share URL to yourself or any contact. The preview card should appear in the chat input before sending.

- [ ] **Step 8: Slack**

In any Slack workspace, paste the URL into a message. The unfurl should show the OG image and title.

- [ ] **Step 9: iMessage**

On a Mac, paste the URL into a chat. The link card should preview.

- [ ] **Step 10: Negative cases**

- `https://veris.news/a/00000000-0000-0000-0000-000000000000` — should 404 with the Veris-branded 404 page.
- Mark one of your analyses as not shareable in Supabase (`UPDATE analyses SET shareable=false WHERE id='...'`) — verify the URL returns 404. Reset it back to `true` after.

- [ ] **Step 11: Document any deviations**

If something didn't render the way the mockup showed (font weights off, gradient missing, etc.), capture screenshots and file a follow-up note. Don't block on cosmetic issues — they're tightening passes, not launch blockers.

---

## Rollout order (summary for the merge step)

1. Phase 1 (DB migration + bucket) is done in Supabase BEFORE any backend code is pushed.
2. Backend code (Phases 2 + 3) deploys via Railway on push to `main`.
3. Frontend code (Phases 4 + 5 + 6 + 7) deploys via Cloudflare on push to `main`.

If you push everything together, the order falls naturally because Cloudflare Pages won't try to hit `/a/*` or `/og/*` until users click a share button — and the share buttons aren't visible until the frontend deploys. The window of inconsistency is brief and benign.

---

## Spec coverage checklist

Mapping spec sections to plan tasks (verified during self-review):

| Spec section | Plan task |
|---|---|
| Backend: `share.py` with three functions | Tasks 4, 4b, 5, 6 |
| Backend: `db.py` additions | Task 7 |
| Backend: routes `/a/{id}` and `/og/{id}.png` | Tasks 8, 9 |
| Backend: bundle DM Sans, add Pillow | Task 3 |
| Database: add `shareable` column | Task 1 |
| Storage: `og-cards` bucket | Task 2 |
| Frontend: `_redirects` for Cloudflare routing | Task 11 |
| Frontend: share row on results | Tasks 12, 13 |
| Frontend: share button on history | Task 14 |
| Frontend: privacy policy update | Task 16 |
| Extension: share row in popup | Task 15 |
| `/analyze` returns analysis_id | Task 10 |
| Manual verification on social platforms | Task 17 |
