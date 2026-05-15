import io
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
