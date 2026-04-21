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
