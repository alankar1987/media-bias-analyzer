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
    """HTML-escape any string we interpolate into the template.

    Escapes &, <, >, and " (so the result is safe inside both text nodes and
    double-quoted attribute values). Intentionally leaves ' unescaped — the
    template only uses double-quoted attributes, so apostrophes in headlines
    like "Court's Decision" render naturally without &#x27; artifacts.
    """
    if value is None:
        return ""
    s = str(value)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


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
