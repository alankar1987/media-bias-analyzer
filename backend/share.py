"""Share-page rendering + Open Graph image generation.

Three responsibilities, kept in one module because they share data shape and
template constants:

1. render_share_html(analysis)         — public HTML page for /a/{id}
2. render_og_image(analysis)           — 1200x630 PNG bytes for /og/{id}.png
3. get_or_create_og_png(...)           — Storage caching wrapper around (2)
"""

import io
import logging
import os
from typing import Optional
from urllib.parse import quote_plus

from PIL import Image, ImageDraw, ImageFont

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

    framing_html = _framing_choices_section(result.get("political_lean") or {})
    fact_html = _fact_claims_section(result.get("fact_check") or {})
    broaden_html = _broaden_view_section(result.get("broaden_your_view") or [])

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
  {framing_html}
  {fact_html}
  {broaden_html}
  <div class="footer-cta">
    <h3>Read news with clearer eyes.</h3>
    <p>Veris analyzes any article for political lean, tone, and factual accuracy.</p>
    <a href="{SITE_BASE}/">Analyze your article →</a>
  </div>
</main>
</body>
</html>"""
