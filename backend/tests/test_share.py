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
