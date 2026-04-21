import os
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

import pytest
from unittest.mock import MagicMock, patch
from auth import verify_jwt, get_quota, QuotaInfo, FREE_LIMIT, PAID_LIMIT

def test_free_limit_constant():
    assert FREE_LIMIT == 3

def test_paid_limit_constant():
    assert PAID_LIMIT == 30

def test_get_quota_free_user_under_limit():
    info = QuotaInfo(user_id="u1", tier="free", used=1, limit=FREE_LIMIT)
    assert info.allowed is True

def test_get_quota_free_user_at_limit():
    info = QuotaInfo(user_id="u1", tier="free", used=3, limit=FREE_LIMIT)
    assert info.allowed is False

def test_get_quota_paid_user_under_limit():
    info = QuotaInfo(user_id="u1", tier="paid", used=15, limit=PAID_LIMIT)
    assert info.allowed is True

def test_get_quota_paid_user_at_limit():
    info = QuotaInfo(user_id="u1", tier="paid", used=30, limit=PAID_LIMIT)
    assert info.allowed is False

def test_verify_jwt_invalid_raises():
    with patch("auth._supabase") as mock_sb:
        mock_sb.auth.get_user.side_effect = Exception("invalid token")
        with pytest.raises(ValueError, match="Invalid or expired token"):
            verify_jwt("bad.token.here")
