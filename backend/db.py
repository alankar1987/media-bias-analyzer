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
    """Hard-delete a user's data and remove them from Supabase Auth.

    Originally relied on a single _supabase.auth.admin.delete_user(...) call
    and a CASCADE on the FK to auth.users. That left a real-world failure mode
    where the analyses table is keyed by user_id but not actually cascade-
    linked — so deleted users' history reappeared if Supabase reused/recreated
    the same user_id (which can happen on Google re-sign-in if the auth delete
    silently failed). Defense-in-depth: clear the rows ourselves first.
    """
    try:
        _supabase.table("analyses").delete().eq("user_id", user_id).execute()
    except Exception as exc:
        logger.error("delete_user: failed to delete analyses for %s: %s", user_id, exc)
    try:
        _supabase.table("subscriptions").delete().eq("user_id", user_id).execute()
    except Exception as exc:
        logger.error("delete_user: failed to delete subscriptions for %s: %s", user_id, exc)
    # Finally remove the auth user. Surface failures — the route's caller should
    # see a 500 rather than silently returning success when this didn't work.
    _supabase.auth.admin.delete_user(user_id)


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

    Returns True only when a row was actually updated. PostgREST does not raise
    when zero rows match — without this check, a wrong analysis_id or user_id
    would silently return success.
    """
    try:
        res = _supabase.table("analyses").update({"shareable": shareable}).eq("id", analysis_id).eq("user_id", user_id).execute()
        return bool(res.data)
    except Exception as exc:
        logger.error("set_shareable(%s) failed: %s", analysis_id, exc)
        return False
