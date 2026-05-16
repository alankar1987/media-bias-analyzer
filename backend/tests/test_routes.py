import os
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


@pytest.fixture
def client():
    with patch("auth._supabase"), patch("db._supabase"), patch("stripe_client._supabase"), patch("stripe_client.stripe"):
        from main import app
        return TestClient(app)


def test_get_usage_no_auth(client):
    resp = client.get("/auth/usage")
    assert resp.status_code == 401


def test_get_usage_invalid_token(client):
    with patch("main.verify_jwt", side_effect=ValueError("bad token")):
        resp = client.get("/auth/usage", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401


def test_get_usage_valid_token(client):
    with patch("main.verify_jwt", return_value={"id": "u1", "email": "a@b.com"}), \
         patch("main.get_quota", return_value=MagicMock(used=1, limit=3, tier="free")):
        resp = client.get("/auth/usage", headers={"Authorization": "Bearer validtoken"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["analyses_this_month"] == 1
    assert body["limit"] == 3
    assert body["tier"] == "free"


def test_analyze_quota_exceeded_returns_402(client):
    with patch("main.verify_jwt", return_value={"id": "u1", "email": "a@b.com"}), \
         patch("main.get_quota", return_value=MagicMock(used=3, limit=3, tier="free", allowed=False)):
        resp = client.post(
            "/analyze",
            json={"text": "x" * 100},
            headers={"Authorization": "Bearer validtoken"},
        )
    assert resp.status_code == 402
    assert resp.json()["tier"] == "free"


def test_delete_account_no_auth(client):
    resp = client.delete("/auth/account")
    assert resp.status_code == 401


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
