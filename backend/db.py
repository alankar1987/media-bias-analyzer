import logging
import os
from typing import Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)

_supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


def save_analysis(
    *,
    user_id: str,
    url: Optional[str],
    source_name: Optional[str],
    headline: Optional[str],
    lean_label: Optional[str],
    lean_numeric: Optional[int],
    fact_score: Optional[int],
    result_json: dict,
    article_text: str,
    content_hash: Optional[str] = None,
) -> Optional[str]:
    """Insert analysis row. Returns the new row id, or None on failure (non-fatal)."""
    try:
        row = {
            "user_id": user_id,
            "url": url,
            "source_name": source_name,
            "headline": headline,
            "lean_label": lean_label,
            "lean_numeric": lean_numeric,
            "fact_score": fact_score,
            "result_json": result_json,
            "article_text": article_text,
            "content_hash": content_hash,
        }
        res = _supabase.table("analyses").insert(row).execute()
        return res.data[0]["id"] if res.data else None
    except Exception as exc:
        logger.error("Failed to save analysis: %s", exc)
        return None


def find_cached_analysis(content_hash: str, max_age_days: int = 30) -> Optional[dict]:
    """Return the most recent result_json with this content_hash within max_age_days, else None."""
    if not content_hash:
        return None
    try:
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
        res = (
            _supabase.table("analyses")
            .select("result_json")
            .eq("content_hash", content_hash)
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("result_json"):
            return res.data[0]["result_json"]
        return None
    except Exception as exc:
        logger.error("Failed to look up cache for %s: %s", content_hash, exc)
        return None


def get_history(*, user_id: str, offset: int = 0, limit: int = 20) -> list[dict]:
    """Return paginated analysis history for a user, newest first."""
    try:
        res = (
            _supabase.table("analyses")
            .select("id, created_at, url, source_name, headline, lean_label, lean_numeric, fact_score")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        logger.error("Failed to fetch history: %s", exc)
        return []


def get_analysis(*, analysis_id: str, user_id: str) -> Optional[dict]:
    """Fetch a single full analysis row (includes result_json). Returns None if not found."""
    try:
        res = (
            _supabase.table("analyses")
            .select("*")
            .eq("id", analysis_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return res.data
    except Exception as exc:
        logger.error("Failed to fetch analysis %s: %s", analysis_id, exc)
        return None


def delete_user(*, user_id: str) -> None:
    """Delete user from Supabase Auth (cascades to analyses and subscriptions)."""
    _supabase.auth.admin.delete_user(user_id)
