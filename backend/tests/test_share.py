import io
import os
from unittest.mock import MagicMock, patch
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


def test_render_og_image_handles_missing_optional_fields():
    """Sanity check: empty / None fields don't crash the renderer."""
    from share import render_og_image
    minimal = {
        "id": "minimal-id",
        "url": None,
        "source_name": None,
        "headline": None,
        "lean_label": None,
        "lean_numeric": None,
        "fact_score": None,
        "shareable": True,
        "result_json": None,
    }
    png = render_og_image(minimal)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


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
    assert call.kwargs["path"] == f"{SAMPLE_ANALYSIS['id']}.png"
    assert call.kwargs["file_options"]["content-type"] == "image/png"
    assert "immutable" in call.kwargs["file_options"]["cache-control"]


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
