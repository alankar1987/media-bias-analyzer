import os
from dataclasses import dataclass
from datetime import datetime, timezone

from supabase import create_client, Client

FREE_LIMIT = 3
PAID_LIMIT = 30

_supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


@dataclass
class QuotaInfo:
    user_id: str
    tier: str          # "free" | "paid"
    used: int
    limit: int

    @property
    def allowed(self) -> bool:
        return self.used < self.limit


def verify_jwt(token: str) -> dict:
    """Verify a Supabase JWT and return the user dict. Raises ValueError if invalid."""
    try:
        response = _supabase.auth.get_user(token)
        return {"id": response.user.id, "email": response.user.email}
    except Exception as exc:
        raise ValueError("Invalid or expired token") from exc


def get_quota(user_id: str) -> QuotaInfo:
    """Return quota info for a user based on their subscription and monthly usage."""
    # Check subscription status
    sub = (
        _supabase.table("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    now = datetime.now(timezone.utc)
    tier = "free"
    if sub.data and sub.data.get("status") == "active":
        period_end = sub.data.get("current_period_end")
        if period_end:
            pe = datetime.fromisoformat(period_end.replace("Z", "+00:00"))
            if pe > now:
                tier = "paid"

    # Count analyses this calendar month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    count_result = (
        _supabase.table("analyses")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .gte("created_at", month_start)
        .execute()
    )
    used = count_result.count or 0
    limit = PAID_LIMIT if tier == "paid" else FREE_LIMIT

    return QuotaInfo(user_id=user_id, tier=tier, used=used, limit=limit)
