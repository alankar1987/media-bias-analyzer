import logging
import os

import stripe
from supabase import create_client, Client

logger = logging.getLogger(__name__)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")

_supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


def create_checkout_session(
    *,
    user_id: str,
    user_email: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create a Stripe Checkout session and return its URL."""
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer_email=user_email,
        line_items=[{"price": _PRICE_ID, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=user_id,
        metadata={"user_id": user_id},
    )
    return session.url


def cancel_subscription(*, user_id: str) -> None:
    """Cancel the user's active Stripe subscription. Logs failures, does not raise."""
    try:
        sub_row = (
            _supabase.table("subscriptions")
            .select("stripe_sub_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not sub_row.data or not sub_row.data.get("stripe_sub_id"):
            return
        stripe.Subscription.cancel(sub_row.data["stripe_sub_id"])
    except Exception as exc:
        logger.error("Failed to cancel Stripe subscription for %s: %s", user_id, exc)


def handle_webhook(payload: bytes, sig_header: str) -> None:
    """Verify and process a Stripe webhook event."""
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    event = stripe.Webhook.construct_event(payload, sig_header, secret)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session["metadata"].get("user_id")
        customer_id = session["customer"]
        sub_id = session["subscription"]
        if user_id:
            _supabase.table("subscriptions").upsert({
                "user_id": user_id,
                "stripe_customer": customer_id,
                "stripe_sub_id": sub_id,
                "status": "active",
            }).execute()

    elif event["type"] in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub = event["data"]["object"]
        _supabase.table("subscriptions").update({
            "status": sub["status"],
            "current_period_end": sub.get("current_period_end"),
        }).eq("stripe_sub_id", sub["id"]).execute()
