# User Accounts & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth sign-in, per-user analysis history, a card-grid history dashboard with media diet stats, free/paid quota enforcement, Stripe subscription billing, and self-serve account deletion to Veris.

**Architecture:** Supabase handles Google OAuth and Postgres (with row-level security). The Railway FastAPI backend gains an `auth.py` module for JWT verification and quota checks, a `db.py` module for Supabase DB operations, and a `stripe_client.py` module for billing. Existing `/analyze` and `/compare` routes are extended to optionally accept a JWT — when present they enforce quota and save results; when absent they apply anonymous rules (1-try cookie + IP rate limit).

**Tech Stack:** Python 3.11, FastAPI, Supabase (supabase-py 2.x), Stripe (stripe 10.x), pytest, httpx; Vanilla JS with Supabase JS CDN on the frontend.

---

## File Map

**New backend files:**
- `backend/auth.py` — JWT verification, user lookup, quota calculation
- `backend/db.py` — Supabase client init, save_analysis, get_history, delete_user
- `backend/stripe_client.py` — create_checkout_session, cancel_subscription
- `backend/rate_limit.py` — in-memory IP rate limiter + anon cookie logic
- `backend/tests/test_auth.py`
- `backend/tests/test_db.py`
- `backend/tests/test_stripe_client.py`
- `backend/tests/test_rate_limit.py`
- `backend/tests/test_routes.py`

**Modified backend files:**
- `backend/main.py` — add new routes, wire auth/quota into /analyze and /compare
- `backend/requirements.txt` — add supabase, stripe, pytest-mock

**New frontend files:**
- `frontend/auth.js` — Supabase JS client, sign-in/sign-out, session management
- `frontend/history.js` — fetch and render history page

**Modified frontend files:**
- `frontend/index.html` — auth button in header, history section, upgrade modal, account settings modal
- `frontend/style.css` — auth button, history card, upgrade modal, account modal styles
- `frontend/script.js` — pass JWT on analyze/compare calls, handle 402 quota errors

---

## Task 1: Supabase Project Setup

> Manual steps — no code written yet.

- [ ] **Step 1: Create Supabase project**

  Go to https://supabase.com → New project → name it `veris-prod`. Note the **Project URL** and **anon public key** and **service role key** from Settings → API.

- [ ] **Step 2: Enable Google OAuth**

  In Supabase dashboard → Authentication → Providers → Google → enable it. You need a Google Cloud OAuth client ID/secret (create at console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID, set Authorized redirect URI to `https://YOUR_PROJECT.supabase.co/auth/v1/callback`). Paste Client ID and Secret into Supabase.

  Also add `https://veris.news` and `http://localhost:8787` (Cloudflare dev) to Supabase → Authentication → URL Configuration → Redirect URLs.

- [ ] **Step 3: Run DB schema SQL**

  In Supabase → SQL Editor, run:

  ```sql
  -- analyses table
  create table analyses (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references auth.users(id) on delete cascade not null,
    created_at   timestamptz default now(),
    url          text,
    source_name  text,
    headline     text,
    lean_label   text,
    lean_numeric smallint,
    fact_score   smallint,
    result_json  jsonb,
    article_text text
  );

  create index on analyses(user_id, created_at desc);

  alter table analyses enable row level security;
  create policy "users see own rows" on analyses
    for all using (auth.uid() = user_id);

  -- subscriptions table
  create table subscriptions (
    user_id             uuid primary key references auth.users(id) on delete cascade,
    stripe_customer     text unique,
    stripe_sub_id       text unique,
    status              text default 'inactive',
    current_period_end  timestamptz
  );

  alter table subscriptions enable row level security;
  create policy "users see own row" on subscriptions
    for all using (auth.uid() = user_id);
  ```

- [ ] **Step 4: Verify tables exist**

  In Supabase → Table Editor, confirm `analyses` and `subscriptions` both appear with the correct columns.

---

## Task 2: Backend Dependencies & Env Vars

- [ ] **Step 1: Update requirements.txt**

  Replace the contents of `backend/requirements.txt` with (add these three lines at the top, keep the rest):

  ```
  supabase==2.15.2
  stripe==11.4.1
  pytest==8.3.5
  pytest-mock==3.14.0
  pytest-asyncio==0.26.0
  ```

  Full file should start:
  ```
  supabase==2.15.2
  stripe==11.4.1
  pytest==8.3.5
  pytest-mock==3.14.0
  pytest-asyncio==0.26.0
  annotated-doc==0.0.4
  newspaper3k==0.2.8
  ... (rest unchanged)
  ```

- [ ] **Step 2: Update backend/.env.example**

  Add these lines to `backend/.env.example`:
  ```
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_ID=price_...
  ```

- [ ] **Step 3: Install new dependencies**

  ```bash
  cd backend && source venv/bin/activate && pip install supabase==2.15.2 stripe==11.4.1 pytest==8.3.5 pytest-mock==3.14.0 pytest-asyncio==0.26.0
  ```

  Expected: packages install without errors.

- [ ] **Step 4: Create tests directory**

  ```bash
  mkdir -p backend/tests && touch backend/tests/__init__.py
  ```

---

## Task 3: Rate Limiter

**Files:**
- Create: `backend/rate_limit.py`
- Create: `backend/tests/test_rate_limit.py`

- [ ] **Step 1: Write the failing tests**

  Create `backend/tests/test_rate_limit.py`:

  ```python
  import time
  from fastapi.testclient import TestClient
  from rate_limit import RateLimiter, ANON_COOKIE_NAME

  def test_ip_under_limit():
      rl = RateLimiter(max_per_hour=5)
      for _ in range(5):
          assert rl.check_ip("1.2.3.4") is True

  def test_ip_over_limit():
      rl = RateLimiter(max_per_hour=5)
      for _ in range(5):
          rl.check_ip("1.2.3.4")
      assert rl.check_ip("1.2.3.4") is False

  def test_different_ips_independent():
      rl = RateLimiter(max_per_hour=2)
      rl.check_ip("1.1.1.1")
      rl.check_ip("1.1.1.1")
      assert rl.check_ip("2.2.2.2") is True

  def test_cookie_name_constant():
      assert ANON_COOKIE_NAME == "veris_anon"
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_rate_limit.py -v
  ```

  Expected: `ModuleNotFoundError: No module named 'rate_limit'`

- [ ] **Step 3: Implement rate_limit.py**

  Create `backend/rate_limit.py`:

  ```python
  import time
  from collections import defaultdict

  ANON_COOKIE_NAME = "veris_anon"
  _WINDOW = 3600  # seconds


  class RateLimiter:
      def __init__(self, max_per_hour: int = 5):
          self._max = max_per_hour
          self._hits: dict[str, list[float]] = defaultdict(list)

      def check_ip(self, ip: str) -> bool:
          """Return True if request is allowed, False if rate-limited. Records the hit."""
          now = time.time()
          window_start = now - _WINDOW
          hits = [t for t in self._hits[ip] if t > window_start]
          if len(hits) >= self._max:
              self._hits[ip] = hits
              return False
          hits.append(now)
          self._hits[ip] = hits
          return True


  _limiter = RateLimiter()


  def get_limiter() -> RateLimiter:
      return _limiter
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_rate_limit.py -v
  ```

  Expected: 4 tests PASSED.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/rate_limit.py backend/tests/test_rate_limit.py backend/tests/__init__.py
  git commit -m "feat: add IP rate limiter for anonymous users"
  ```

---

## Task 4: Auth Module (JWT Verification + Quota)

**Files:**
- Create: `backend/auth.py`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests**

  Create `backend/tests/test_auth.py`:

  ```python
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
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_auth.py -v
  ```

  Expected: `ModuleNotFoundError: No module named 'auth'`

- [ ] **Step 3: Implement auth.py**

  Create `backend/auth.py`:

  ```python
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
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_auth.py -v
  ```

  Expected: 7 tests PASSED.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/auth.py backend/tests/test_auth.py
  git commit -m "feat: add JWT verification and quota checking"
  ```

---

## Task 5: Database Module

**Files:**
- Create: `backend/db.py`
- Create: `backend/tests/test_db.py`

- [ ] **Step 1: Write the failing tests**

  Create `backend/tests/test_db.py`:

  ```python
  import pytest
  from unittest.mock import MagicMock, patch

  def test_save_analysis_returns_id(mocker):
      mock_sb = mocker.patch("db._supabase")
      mock_sb.table.return_value.insert.return_value.execute.return_value.data = [{"id": "abc-123"}]
      from db import save_analysis
      result = save_analysis(
          user_id="u1",
          url="https://example.com",
          source_name="NYT",
          headline="Test headline",
          lean_label="Center-left",
          lean_numeric=-3,
          fact_score=78,
          result_json={"foo": "bar"},
          article_text="Some text here",
      )
      assert result == "abc-123"

  def test_save_analysis_insert_failure_does_not_raise(mocker):
      mock_sb = mocker.patch("db._supabase")
      mock_sb.table.return_value.insert.return_value.execute.side_effect = Exception("db error")
      from db import save_analysis
      result = save_analysis(
          user_id="u1", url=None, source_name=None, headline=None,
          lean_label=None, lean_numeric=None, fact_score=None,
          result_json={}, article_text="",
      )
      assert result is None

  def test_get_history_returns_list(mocker):
      mock_sb = mocker.patch("db._supabase")
      mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value.data = [
          {"id": "1", "headline": "Test"}
      ]
      from db import get_history
      result = get_history(user_id="u1", offset=0, limit=20)
      assert result == [{"id": "1", "headline": "Test"}]
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_db.py -v
  ```

  Expected: `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: Implement db.py**

  Create `backend/db.py`:

  ```python
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
          }
          res = _supabase.table("analyses").insert(row).execute()
          return res.data[0]["id"] if res.data else None
      except Exception as exc:
          logger.error("Failed to save analysis: %s", exc)
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
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_db.py -v
  ```

  Expected: 3 tests PASSED.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/db.py backend/tests/test_db.py
  git commit -m "feat: add Supabase DB module for analysis storage and history"
  ```

---

## Task 6: Stripe Module

**Files:**
- Create: `backend/stripe_client.py`
- Create: `backend/tests/test_stripe_client.py`

- [ ] **Step 1: Write the failing tests**

  Create `backend/tests/test_stripe_client.py`:

  ```python
  import pytest
  from unittest.mock import MagicMock, patch

  def test_create_checkout_session_returns_url(mocker):
      mock_stripe = mocker.patch("stripe_client.stripe")
      mock_stripe.checkout.Session.create.return_value = MagicMock(url="https://checkout.stripe.com/pay/cs_test_abc")
      from stripe_client import create_checkout_session
      url = create_checkout_session(user_id="u1", user_email="user@example.com", success_url="https://veris.news?upgraded=1", cancel_url="https://veris.news")
      assert url == "https://checkout.stripe.com/pay/cs_test_abc"

  def test_cancel_subscription_calls_stripe(mocker):
      mock_stripe = mocker.patch("stripe_client.stripe")
      mock_stripe.Customer.list.return_value = MagicMock(data=[MagicMock(id="cus_abc")])
      mock_stripe.Subscription.list.return_value = MagicMock(data=[MagicMock(id="sub_xyz")])
      mock_stripe.Subscription.cancel.return_value = MagicMock(status="canceled")
      from stripe_client import cancel_subscription
      cancel_subscription(user_id="u1")
      mock_stripe.Subscription.cancel.assert_called_once_with("sub_xyz")

  def test_cancel_subscription_no_customer_does_not_raise(mocker):
      mock_sb = mocker.patch("stripe_client._supabase")
      mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
      mock_stripe = mocker.patch("stripe_client.stripe")
      from stripe_client import cancel_subscription
      cancel_subscription(user_id="u1")  # should not raise
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_stripe_client.py -v
  ```

  Expected: `ModuleNotFoundError: No module named 'stripe_client'`

- [ ] **Step 3: Implement stripe_client.py**

  Create `backend/stripe_client.py`:

  ```python
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
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_stripe_client.py -v
  ```

  Expected: 3 tests PASSED.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/stripe_client.py backend/tests/test_stripe_client.py
  git commit -m "feat: add Stripe checkout and webhook handling"
  ```

---

## Task 7: New Backend Routes + Modified /analyze

**Files:**
- Modify: `backend/main.py`
- Create: `backend/tests/test_routes.py`

- [ ] **Step 1: Write the failing tests**

  Create `backend/tests/test_routes.py`:

  ```python
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
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/test_routes.py -v
  ```

  Expected: failures related to missing routes/imports.

- [ ] **Step 3: Update main.py — add imports and new route helpers**

  At the top of `backend/main.py`, after the existing imports, add:

  ```python
  from fastapi import Depends, Header
  from fastapi.responses import Response
  from auth import verify_jwt, get_quota, QuotaInfo
  from db import save_analysis, get_history, get_analysis, delete_user as db_delete_user
  import stripe_client
  from rate_limit import get_limiter, ANON_COOKIE_NAME
  ```

  Add these helper functions after the existing `MIN_TEXT_LENGTH` line:

  ```python
  def _get_user_from_header(authorization: Optional[str] = Header(default=None)) -> Optional[dict]:
      """Extract and verify JWT from Authorization header. Returns user dict or None."""
      if not authorization or not authorization.startswith("Bearer "):
          return None
      token = authorization.removeprefix("Bearer ").strip()
      try:
          return verify_jwt(token)
      except ValueError:
          return None
  ```

- [ ] **Step 4: Add GET /auth/usage route to main.py**

  Add after the `/health` route:

  ```python
  @app.get("/auth/usage", tags=["auth"])
  async def get_usage(authorization: Optional[str] = Header(default=None)):
      if not authorization or not authorization.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Authentication required")
      token = authorization.removeprefix("Bearer ").strip()
      try:
          user = verify_jwt(token)
      except ValueError:
          raise HTTPException(status_code=401, detail="Invalid or expired token")
      quota = get_quota(user["id"])
      return {
          "analyses_this_month": quota.used,
          "limit": quota.limit,
          "tier": quota.tier,
      }
  ```

- [ ] **Step 5: Add POST /stripe/checkout route to main.py**

  ```python
  @app.post("/stripe/checkout", tags=["billing"])
  async def checkout(authorization: Optional[str] = Header(default=None)):
      if not authorization or not authorization.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Authentication required")
      token = authorization.removeprefix("Bearer ").strip()
      try:
          user = verify_jwt(token)
      except ValueError:
          raise HTTPException(status_code=401, detail="Invalid or expired token")
      try:
          url = stripe_client.create_checkout_session(
              user_id=user["id"],
              user_email=user["email"],
              success_url="https://veris.news?upgraded=1",
              cancel_url="https://veris.news",
          )
      except Exception as exc:
          logger.error("Stripe checkout error: %s", exc)
          raise HTTPException(status_code=500, detail="Could not create checkout session")
      return {"url": url}
  ```

- [ ] **Step 6: Add POST /stripe/webhook route to main.py**

  ```python
  @app.post("/stripe/webhook", tags=["billing"])
  async def stripe_webhook(request: Request):
      payload = await request.body()
      sig = request.headers.get("stripe-signature", "")
      try:
          stripe_client.handle_webhook(payload, sig)
      except Exception as exc:
          logger.error("Webhook error: %s", exc)
          raise HTTPException(status_code=400, detail="Webhook processing failed")
      return {"received": True}
  ```

- [ ] **Step 7: Add DELETE /auth/account route to main.py**

  ```python
  @app.delete("/auth/account", tags=["auth"])
  async def delete_account(authorization: Optional[str] = Header(default=None)):
      if not authorization or not authorization.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Authentication required")
      token = authorization.removeprefix("Bearer ").strip()
      try:
          user = verify_jwt(token)
      except ValueError:
          raise HTTPException(status_code=401, detail="Invalid or expired token")
      # Cancel Stripe subscription first (best-effort)
      try:
          stripe_client.cancel_subscription(user_id=user["id"])
      except Exception as exc:
          logger.warning("Stripe cancel failed for %s during deletion: %s", user["id"], exc)
      # Delete user from Supabase (cascades to all data)
      db_delete_user(user_id=user["id"])
      return {"deleted": True}
  ```

- [ ] **Step 8: Add GET /auth/history route to main.py**

  ```python
  @app.get("/auth/history", tags=["auth"])
  async def history(
      offset: int = 0,
      limit: int = 20,
      authorization: Optional[str] = Header(default=None),
  ):
      if not authorization or not authorization.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Authentication required")
      token = authorization.removeprefix("Bearer ").strip()
      try:
          user = verify_jwt(token)
      except ValueError:
          raise HTTPException(status_code=401, detail="Invalid or expired token")
      rows = get_history(user_id=user["id"], offset=offset, limit=min(limit, 50))
      return {"items": rows, "offset": offset, "limit": limit}


  @app.get("/auth/history/{analysis_id}", tags=["auth"])
  async def history_item(analysis_id: str, authorization: Optional[str] = Header(default=None)):
      if not authorization or not authorization.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Authentication required")
      token = authorization.removeprefix("Bearer ").strip()
      try:
          user = verify_jwt(token)
      except ValueError:
          raise HTTPException(status_code=401, detail="Invalid or expired token")
      row = get_analysis(analysis_id=analysis_id, user_id=user["id"])
      if not row:
          raise HTTPException(status_code=404, detail="Analysis not found")
      return row
  ```

- [ ] **Step 9: Update /analyze to enforce quota + save result**

  Replace the existing `@app.post("/analyze" ...)` function with:

  ```python
  @app.post("/analyze", response_model=AnalyzeResponse, tags=["analysis"])
  async def analyze(req: AnalyzeRequest, request: Request, authorization: Optional[str] = Header(default=None)):
      user = None
      quota: Optional[QuotaInfo] = None

      # ── Auth: check JWT if present ──────────────────────────────────────────
      if authorization and authorization.startswith("Bearer "):
          token = authorization.removeprefix("Bearer ").strip()
          try:
              user = verify_jwt(token)
          except ValueError:
              raise HTTPException(status_code=401, detail="Invalid or expired token")
          quota = get_quota(user["id"])
          if not quota.allowed:
              return JSONResponse(
                  status_code=402,
                  content={"success": False, "error": "quota_exceeded", "tier": quota.tier, "limit": quota.limit},
              )

      # ── Anonymous: cookie + IP rate limit ──────────────────────────────────
      if user is None:
          anon_cookie = request.cookies.get(ANON_COOKIE_NAME)
          if anon_cookie:
              return JSONResponse(
                  status_code=429,
                  content={"success": False, "error": "anon_limit", "message": "Sign up free for 3 analyses/month."},
              )
          client_ip = request.headers.get("x-forwarded-for", request.client.host).split(",")[0].strip()
          if not get_limiter().check_ip(client_ip):
              return JSONResponse(
                  status_code=429,
                  content={"success": False, "error": "rate_limited", "message": "Too many requests. Try again later."},
              )

      article_text = req.text
      source_url = req.url

      # ── 1. Fetch & extract text from URL ────────────────────────────────────
      if source_url:
          try:
              title, extracted = await extract_text_from_url(source_url)
              if not article_text:
                  article_text = f"{title}\n\n{extracted}".strip() if title else extracted
              logger.info("Extracted %d chars from %s", len(extracted), source_url)
          except httpx.HTTPStatusError as exc:
              status = exc.response.status_code
              if status == 403:
                  detail = "This site is blocking access to its content. Please copy and paste the article text directly into the text box below."
              elif status == 401:
                  detail = "This article requires a login. Please copy and paste the article text directly into the text box below."
              else:
                  detail = f"Could not fetch the article (HTTP {status}). Please copy and paste the article text directly into the text box below."
              raise HTTPException(status_code=422, detail=detail)
          except httpx.RequestError as exc:
              raise HTTPException(status_code=422, detail=f"Could not reach URL — {exc}")
          except ValueError as exc:
              raise HTTPException(status_code=422, detail=str(exc))
          except Exception as exc:
              logger.warning("URL extraction error: %s", exc)
              raise HTTPException(status_code=422, detail=f"Could not extract content from URL: {exc}")

      # ── 2. Guard ────────────────────────────────────────────────────────────
      if not article_text or len(article_text.strip()) < MIN_TEXT_LENGTH:
          raise HTTPException(status_code=422, detail=f"Article text must be at least {MIN_TEXT_LENGTH} characters.")

      # ── 3. Analyse ──────────────────────────────────────────────────────────
      try:
          result = analyze_content(article_text, url=source_url)
      except (ValueError, RuntimeError) as exc:
          raise HTTPException(status_code=500, detail=str(exc))
      except Exception as exc:
          logger.error("Unexpected analysis error: %s", exc, exc_info=True)
          raise HTTPException(status_code=500, detail="Analysis failed. Please try again.")

      # ── 4. Save if logged in ────────────────────────────────────────────────
      if user:
          lean = result.get("political_lean", {})
          fc = result.get("fact_check", {})
          source = result.get("source", {})
          loop = asyncio.get_event_loop()
          await loop.run_in_executor(None, lambda: save_analysis(
              user_id=user["id"],
              url=source_url,
              source_name=source.get("outlet"),
              headline=source.get("headline"),
              lean_label=lean.get("label"),
              lean_numeric=lean.get("numeric"),
              fact_score=fc.get("score"),
              result_json=result,
              article_text=article_text[:5000],
          ))

      preview_len = 300
      preview = article_text[:preview_len] + "…" if len(article_text) > preview_len else article_text

      response = JSONResponse(content={"success": True, "data": result, "source_url": source_url, "text_preview": preview})

      # Set anon cookie for first-time anonymous users
      if user is None:
          response.set_cookie(
              key=ANON_COOKIE_NAME,
              value="1",
              max_age=86400,
              httponly=True,
              samesite="strict",
          )

      return response
  ```

- [ ] **Step 10: Update /compare to enforce quota**

  Replace the existing `@app.post("/compare" ...)` function with:

  ```python
  @app.post("/compare", response_model=CompareResponse, tags=["analysis"])
  async def compare(req: CompareRequest, request: Request, authorization: Optional[str] = Header(default=None)):
      user = None

      if authorization and authorization.startswith("Bearer "):
          token = authorization.removeprefix("Bearer ").strip()
          try:
              user = verify_jwt(token)
          except ValueError:
              raise HTTPException(status_code=401, detail="Invalid or expired token")
          quota = get_quota(user["id"])
          if not quota.allowed:
              return JSONResponse(
                  status_code=402,
                  content={"success": False, "error": "quota_exceeded", "tier": quota.tier, "limit": quota.limit},
              )

      if user is None:
          anon_cookie = request.cookies.get(ANON_COOKIE_NAME)
          if anon_cookie:
              return JSONResponse(
                  status_code=429,
                  content={"success": False, "error": "anon_limit", "message": "Sign up free for 3 analyses/month."},
              )
          client_ip = request.headers.get("x-forwarded-for", request.client.host).split(",")[0].strip()
          if not get_limiter().check_ip(client_ip):
              return JSONResponse(
                  status_code=429,
                  content={"success": False, "error": "rate_limited", "message": "Too many requests. Try again later."},
              )

      r1, r2 = await asyncio.gather(
          _process_single(req.article1),
          _process_single(req.article2),
      )

      if user:
          loop = asyncio.get_event_loop()
          for r in (r1, r2):
              if r.success and r.data:
                  lean = r.data.get("political_lean", {})
                  fc = r.data.get("fact_check", {})
                  source = r.data.get("source", {})
                  await loop.run_in_executor(None, lambda r=r: save_analysis(
                      user_id=user["id"],
                      url=r.source_url,
                      source_name=source.get("outlet"),
                      headline=source.get("headline"),
                      lean_label=lean.get("label"),
                      lean_numeric=lean.get("numeric"),
                      fact_score=fc.get("score"),
                      result_json=r.data,
                      article_text=(r.text_preview or ""),
                  ))

      response = CompareResponse(success=r1.success and r2.success, article1=r1, article2=r2)
      if user is None:
          from fastapi.responses import JSONResponse as JR
          jr = JR(content=response.model_dump())
          jr.set_cookie(key=ANON_COOKIE_NAME, value="1", max_age=86400, httponly=True, samesite="strict")
          return jr
      return response
  ```

- [ ] **Step 11: Run all tests**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/ -v
  ```

  Expected: all tests PASSED.

- [ ] **Step 12: Commit**

  ```bash
  git add backend/main.py backend/tests/test_routes.py
  git commit -m "feat: add auth/quota routes and wire into /analyze and /compare"
  ```

---

## Task 8: Frontend — Supabase Auth JS

**Files:**
- Create: `frontend/auth.js`
- Modify: `frontend/index.html` (add Supabase CDN script tag)

- [ ] **Step 1: Add Supabase CDN to index.html**

  In `frontend/index.html`, add before the closing `</body>` tag (before the existing `<script src="script.js">` line):

  ```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="auth.js"></script>
  ```

  The final script order at the bottom of body must be:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="auth.js"></script>
  <script src="history.js"></script>
  <script src="script.js"></script>
  ```
  (history.js will be added in Task 11 — add the tag now as a placeholder, create the empty file)

  ```bash
  touch frontend/history.js
  ```

- [ ] **Step 2: Create auth.js**

  Create `frontend/auth.js`:

  ```javascript
  const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'; // replace with your project URL
  const SUPABASE_ANON_KEY = 'your_anon_public_key';        // replace with your anon key

  const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let _session = null;

  async function authInit() {
    const { data } = await _sb.auth.getSession();
    _session = data.session;
    _sb.auth.onAuthStateChange((_event, session) => {
      _session = session;
      renderAuthUI();
    });
    renderAuthUI();

    // Handle OAuth redirect
    if (window.location.search.includes('upgraded=1')) {
      showToast('Subscription activated! You now have 30 analyses/month.', 'success');
      history.replaceState(null, '', window.location.pathname);
    }
  }

  function getSession() {
    return _session;
  }

  function getToken() {
    return _session?.access_token ?? null;
  }

  async function signInWithGoogle() {
    await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await _sb.auth.signOut();
  }

  function renderAuthUI() {
    const container = document.getElementById('auth-container');
    if (!container) return;
    if (_session) {
      const email = _session.user.email;
      const initial = email[0].toUpperCase();
      container.innerHTML = `
        <button class="auth-avatar" id="auth-menu-btn" title="${email}">${initial}</button>
        <div class="auth-dropdown" id="auth-dropdown" hidden>
          <span class="auth-email">${email}</span>
          <button onclick="showHistoryView()">My History</button>
          <button onclick="showAccountSettings()">Account Settings</button>
          <button onclick="authSignOut()" class="auth-signout">Sign out</button>
        </div>
      `;
      document.getElementById('auth-menu-btn').addEventListener('click', () => {
        document.getElementById('auth-dropdown').toggleAttribute('hidden');
      });
    } else {
      container.innerHTML = `<button class="auth-signin-btn" onclick="signInWithGoogle()">Sign in with Google</button>`;
    }
  }

  async function authSignOut() {
    await signOut();
    hideHistoryView();
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  document.addEventListener('DOMContentLoaded', authInit);
  ```

  **Important:** Replace `YOUR_PROJECT.supabase.co` and `your_anon_public_key` with the actual values from your Supabase project settings (Settings → API → Project URL and anon public key). These are safe to expose in the frontend — anon key is not a secret.

- [ ] **Step 3: Add auth-container to index.html header**

  In `frontend/index.html`, locate the `<header class="site-header">` block and add `<div id="auth-container"></div>` at the end of it:

  ```html
  <header class="site-header">
    <div class="logo">
      <img src="assets/veris-logo-dark.svg" alt="veris.news" class="logo-img" />
    </div>
    <div class="mode-toggle">
      <button class="mode-btn active" id="mode-single">Single Article</button>
      <button class="mode-btn" id="mode-compare">Compare Two</button>
    </div>
    <div id="auth-container"></div>
  </header>
  ```

- [ ] **Step 4: Add auth styles to style.css**

  Append to the end of `frontend/style.css`:

  ```css
  /* ── Auth UI ──────────────────────────────────────────────────────────── */
  #auth-container { position: relative; display: flex; align-items: center; }

  .auth-signin-btn {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.85);
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .auth-signin-btn:hover { background: rgba(255,255,255,0.14); }

  .auth-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: var(--cyan); color: #000;
    border: none; font-weight: 700; font-size: 14px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }

  .auth-dropdown {
    position: absolute; top: 42px; right: 0;
    background: #1a1a1a; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px; padding: 8px; min-width: 200px;
    display: flex; flex-direction: column; gap: 4px;
    z-index: 100;
  }
  .auth-dropdown[hidden] { display: none; }
  .auth-email { font-size: 11px; color: rgba(255,255,255,0.4); padding: 4px 8px; }
  .auth-dropdown button {
    background: none; border: none; color: rgba(255,255,255,0.8);
    text-align: left; padding: 8px 10px; border-radius: 6px;
    cursor: pointer; font-size: 13px;
  }
  .auth-dropdown button:hover { background: rgba(255,255,255,0.07); }
  .auth-signout { color: #fca5a5 !important; }

  /* ── Toast ────────────────────────────────────────────────────────────── */
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: #1a1a1a; border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.9); padding: 12px 18px;
    border-radius: 10px; font-size: 13px; z-index: 1000;
    animation: fadeInUp 0.3s ease;
  }
  .toast-success { border-color: rgba(16,185,129,0.4); }
  .toast-error { border-color: rgba(239,68,68,0.4); }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  ```

- [ ] **Step 5: Manual smoke test**

  Start the app:
  ```bash
  cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000
  ```
  Open `frontend/index.html` in a browser (or via Cloudflare `wrangler dev`). Confirm:
  - "Sign in with Google" button appears in the header
  - Clicking it initiates the OAuth redirect (will redirect to Supabase)

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/auth.js frontend/history.js frontend/index.html frontend/style.css
  git commit -m "feat: add Supabase auth client and sign-in UI"
  ```

---

## Task 9: Frontend — Quota Enforcement & Upgrade Modal

**Files:**
- Modify: `frontend/script.js`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add upgrade modal to index.html**

  Add before the closing `</div><!-- .container -->` tag in `frontend/index.html`:

  ```html
  <!-- Upgrade modal -->
  <div class="modal-overlay" id="upgrade-modal" hidden>
    <div class="modal-box glass-card">
      <h3>You've used all your free analyses</h3>
      <p>Free accounts get 3 analyses per month. Upgrade for 30 analyses/month.</p>
      <div class="modal-pricing">
        <span class="modal-price">$7.99</span>
        <span class="modal-period">/month</span>
      </div>
      <button class="cta-btn" id="upgrade-btn">Subscribe — $7.99/month</button>
      <button class="modal-cancel" onclick="document.getElementById('upgrade-modal').hidden=true">Maybe later</button>
    </div>
  </div>

  <!-- Account settings modal -->
  <div class="modal-overlay" id="account-modal" hidden>
    <div class="modal-box glass-card">
      <h3>Account Settings</h3>
      <div id="account-usage-info" style="margin-bottom:16px;color:rgba(255,255,255,0.6);font-size:13px"></div>
      <button class="modal-danger-btn" id="delete-account-btn">Delete my account</button>
      <button class="modal-cancel" onclick="document.getElementById('account-modal').hidden=true">Close</button>
    </div>
  </div>
  ```

- [ ] **Step 2: Add modal styles to style.css**

  Append to `frontend/style.css`:

  ```css
  /* ── Modals ───────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .modal-overlay[hidden] { display: none; }
  .modal-box {
    max-width: 400px; width: 90%; padding: 32px;
    text-align: center;
  }
  .modal-box h3 { font-size: 20px; margin-bottom: 12px; }
  .modal-box p { color: rgba(255,255,255,0.6); font-size: 14px; margin-bottom: 20px; }
  .modal-pricing { margin: 20px 0; }
  .modal-price { font-size: 36px; font-weight: 700; color: var(--cyan); }
  .modal-period { font-size: 16px; color: rgba(255,255,255,0.5); }
  .modal-cancel {
    background: none; border: none; color: rgba(255,255,255,0.4);
    cursor: pointer; font-size: 13px; margin-top: 12px;
    display: block; width: 100%; text-align: center;
  }
  .modal-cancel:hover { color: rgba(255,255,255,0.7); }
  .modal-danger-btn {
    background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
    color: #fca5a5; border-radius: 8px; padding: 10px 20px;
    cursor: pointer; font-size: 14px; width: 100%; margin-bottom: 8px;
  }
  .modal-danger-btn:hover { background: rgba(239,68,68,0.25); }
  ```

- [ ] **Step 3: Update script.js to pass JWT and handle 402**

  In `frontend/script.js`, locate the `analyzeArticle` function (the one that calls `/analyze`). Modify the `fetch` call to include the Authorization header and handle 402:

  Find the fetch call in `analyzeArticle` that looks like:
  ```javascript
  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  ```

  Replace it with:
  ```javascript
  const token = typeof getToken === 'function' ? getToken() : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (response.status === 402) {
    showUpgradeModal();
    return;
  }
  if (response.status === 429) {
    const body = await response.json();
    if (body.error === 'anon_limit') {
      showAnonLimitMessage();
    } else {
      showError('Too many requests. Please try again later.');
    }
    return;
  }
  ```

  Also apply the same JWT header injection to the `/compare` fetch call in `compareArticles`.

- [ ] **Step 4: Add showUpgradeModal and showAnonLimitMessage to script.js**

  Add these functions to `frontend/script.js`:

  ```javascript
  function showUpgradeModal() {
    document.getElementById('upgrade-modal').hidden = false;
    document.getElementById('upgrade-btn').onclick = async () => {
      const token = typeof getToken === 'function' ? getToken() : null;
      if (!token) { signInWithGoogle(); return; }
      try {
        const res = await fetch(`${API_BASE}/stripe/checkout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const { url } = await res.json();
        window.location.href = url;
      } catch {
        showError('Could not start checkout. Please try again.');
      }
    };
  }

  function showAnonLimitMessage() {
    // Replace the error area with a sign-up prompt
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
      errorEl.innerHTML = `You've used your free try. <button onclick="signInWithGoogle()" style="color:var(--cyan);background:none;border:none;cursor:pointer;font-size:inherit;text-decoration:underline">Sign up free</button> for 3 analyses/month.`;
      errorEl.hidden = false;
    }
  }

  function showAccountSettings() {
    document.getElementById('account-modal').hidden = false;
    document.getElementById('auth-dropdown').setAttribute('hidden', '');
    const token = typeof getToken === 'function' ? getToken() : null;
    if (token) {
      fetch(`${API_BASE}/auth/usage`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          document.getElementById('account-usage-info').textContent =
            `${data.analyses_this_month} / ${data.limit} analyses used this month (${data.tier} plan)`;
        });
    }
    document.getElementById('delete-account-btn').onclick = confirmDeleteAccount;
  }

  async function confirmDeleteAccount() {
    if (!confirm('This will permanently delete your account and all saved analyses. This cannot be undone.')) return;
    const token = typeof getToken === 'function' ? getToken() : null;
    if (!token) return;
    try {
      await fetch(`${API_BASE}/auth/account`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      document.getElementById('account-modal').hidden = true;
      await authSignOut();
      showToast('Your account has been deleted.', 'info');
    } catch {
      showError('Could not delete account. Please try again.');
    }
  }
  ```

- [ ] **Step 5: Manual test — quota flow**

  With the backend running locally:
  1. Sign in with Google
  2. Analyze 3 articles (free tier limit)
  3. Try a 4th — upgrade modal should appear
  4. Click "Maybe later" — modal should close

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/script.js frontend/index.html frontend/style.css
  git commit -m "feat: add quota enforcement and upgrade modal"
  ```

---

## Task 10: Frontend — History Page

**Files:**
- Create: `frontend/history.js`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

- [ ] **Step 1: Add history section to index.html**

  In `frontend/index.html`, add a new section after the compare results section (`#compare-results`), before the closing `.container` div:

  ```html
  <!-- History view -->
  <section id="history-view" hidden>
    <div class="history-header">
      <h2>My History</h2>
      <button class="history-back-btn" onclick="hideHistoryView()">← Back</button>
    </div>

    <!-- Stats row -->
    <div class="history-stats" id="history-stats"></div>

    <!-- Card grid -->
    <div class="history-grid" id="history-grid"></div>

    <div style="text-align:center;margin-top:24px">
      <button class="load-more-btn" id="history-load-more" hidden>Load more</button>
    </div>

    <!-- Expanded analysis drawer -->
    <div class="history-drawer glass-card" id="history-drawer" hidden>
      <button class="drawer-close" onclick="document.getElementById('history-drawer').hidden=true">✕ Close</button>
      <div id="history-drawer-content"></div>
    </div>
  </section>
  ```

- [ ] **Step 2: Implement history.js**

  Create `frontend/history.js`:

  ```javascript
  let _historyOffset = 0;
  const _PAGE_SIZE = 20;

  function showHistoryView() {
    document.getElementById('history-view').hidden = false;
    document.getElementById('single-input-card').closest('section')?.setAttribute('hidden', '');
    document.querySelector('.hero')?.setAttribute('hidden', '');
    document.getElementById('results')?.setAttribute('hidden', '');
    document.getElementById('compare-results')?.setAttribute('hidden', '');
    document.getElementById('auth-dropdown')?.setAttribute('hidden', '');
    _historyOffset = 0;
    document.getElementById('history-grid').innerHTML = '';
    loadHistory();
  }

  function hideHistoryView() {
    document.getElementById('history-view').hidden = true;
    document.querySelector('.hero')?.removeAttribute('hidden');
  }

  async function loadHistory() {
    const token = typeof getToken === 'function' ? getToken() : null;
    if (!token) return;
    const res = await fetch(
      `${API_BASE}/auth/history?offset=${_historyOffset}&limit=${_PAGE_SIZE}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const { items } = await res.json();

    if (_historyOffset === 0) renderStats(items);
    renderCards(items);

    _historyOffset += items.length;
    document.getElementById('history-load-more').hidden = items.length < _PAGE_SIZE;
  }

  function renderStats(items) {
    if (!items.length) {
      document.getElementById('history-stats').innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center">No analyses yet.</p>';
      return;
    }
    const total = items.length;
    const avgScore = Math.round(items.reduce((s, i) => s + (i.fact_score || 0), 0) / total);
    const leanCounts = {};
    items.forEach(i => { if (i.lean_label) leanCounts[i.lean_label] = (leanCounts[i.lean_label] || 0) + 1; });
    const topLean = Object.entries(leanCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

    document.getElementById('history-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value cyan">${total}</div>
        <div class="stat-label">Analyzed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">${topLean}</div>
        <div class="stat-label">Avg Lean</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${avgScore}</div>
        <div class="stat-label">Avg Score</div>
      </div>
    `;
  }

  function leanPosition(numeric) {
    // numeric is -10 to +10, map to 0–100% for the spectrum dot
    if (numeric == null) return 50;
    return Math.round(((numeric + 10) / 20) * 100);
  }

  function scoreColor(score) {
    if (score == null) return 'rgba(255,255,255,0.5)';
    if (score >= 70) return '#10b981';
    if (score >= 50) return '#d97706';
    return '#ef4444';
  }

  function renderCards(items) {
    const grid = document.getElementById('history-grid');
    items.forEach(item => {
      const pos = leanPosition(item.lean_numeric);
      const color = scoreColor(item.fact_score);
      const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const card = document.createElement('div');
      card.className = 'history-card glass-card';
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="hcard-outlet">${item.source_name || 'Unknown'}</div>
        <div class="hcard-headline">${item.headline || item.url || 'Untitled'}</div>
        <div class="lean-bar">
          <div class="lean-dot" style="left:${pos}%"></div>
        </div>
        <div class="hcard-meta">
          <span class="hcard-lean">${item.lean_label || '—'}</span>
          <span class="hcard-score" style="color:${color}">${item.fact_score != null ? item.fact_score + '/100' : '—'}</span>
          <span class="hcard-date">${date}</span>
        </div>
      `;
      card.addEventListener('click', () => openHistoryDrawer(item.id));
      grid.appendChild(card);
    });
  }

  async function openHistoryDrawer(id) {
    const token = typeof getToken === 'function' ? getToken() : null;
    if (!token) return;
    const res = await fetch(`${API_BASE}/auth/history/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const row = await res.json();
    const drawer = document.getElementById('history-drawer');
    document.getElementById('history-drawer-content').innerHTML =
      `<h3>${row.headline || 'Analysis'}</h3>` +
      `<p style="color:rgba(255,255,255,0.4);font-size:12px;margin-bottom:16px">${row.url || ''}</p>` +
      buildResultHTML(row.result_json);
    drawer.hidden = false;
    drawer.scrollIntoView({ behavior: 'smooth' });
  }

  function buildResultHTML(data) {
    if (!data) return '<p>No data available.</p>';
    const lean = data.political_lean || {};
    const fc = data.fact_check || {};
    return `
      <div class="result-summary">
        <div><strong>Lean:</strong> ${lean.label || '—'} (${lean.numeric ?? '—'})</div>
        <div><strong>Fact score:</strong> ${fc.score ?? '—'}/100</div>
        <div><strong>Summary:</strong> ${lean.summary || '—'}</div>
      </div>
    `;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const loadMoreBtn = document.getElementById('history-load-more');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadHistory);
  });
  ```

- [ ] **Step 3: Add history styles to style.css**

  Append to `frontend/style.css`:

  ```css
  /* ── History ──────────────────────────────────────────────────────────── */
  #history-view { padding: 40px 0; }

  .history-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 28px;
  }
  .history-header h2 { font-size: 24px; font-weight: 700; }
  .history-back-btn {
    background: none; border: none; color: rgba(255,255,255,0.5);
    cursor: pointer; font-size: 14px;
  }
  .history-back-btn:hover { color: rgba(255,255,255,0.85); }

  .history-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 12px; margin-bottom: 28px;
  }
  .stat-card {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 16px; text-align: center;
  }
  .stat-value { font-size: 22px; font-weight: 700; }
  .stat-value.cyan { color: var(--cyan); }
  .stat-value.purple { color: var(--purple); }
  .stat-value.green { color: var(--green); }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.4); margin-top: 4px; }

  .history-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .history-card {
    padding: 16px; cursor: pointer; transition: border-color 0.2s;
  }
  .history-card:hover { border-color: rgba(255,255,255,0.25); }
  .hcard-outlet { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.4); margin-bottom: 6px; }
  .hcard-headline { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.85); line-height: 1.4; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .lean-bar {
    height: 4px; border-radius: 99px;
    background: linear-gradient(to right, #3b82f6, #a78bfa, #ef4444);
    margin-bottom: 8px; position: relative;
  }
  .lean-dot {
    position: absolute; top: -4px;
    width: 10px; height: 10px; border-radius: 50%;
    background: #fff; border: 2px solid #333;
    transform: translateX(-50%);
  }

  .hcard-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
  .hcard-lean { color: rgba(255,255,255,0.5); }
  .hcard-score { font-weight: 600; }
  .hcard-date { color: rgba(255,255,255,0.35); }

  .load-more-btn {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.7); border-radius: 8px; padding: 10px 24px;
    cursor: pointer; font-size: 13px;
  }
  .load-more-btn:hover { background: rgba(255,255,255,0.1); }

  .history-drawer {
    margin-top: 24px; padding: 24px; position: relative;
  }
  .drawer-close {
    position: absolute; top: 16px; right: 16px;
    background: none; border: none; color: rgba(255,255,255,0.5);
    cursor: pointer; font-size: 13px;
  }
  .result-summary { display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: rgba(255,255,255,0.8); }

  @media (max-width: 560px) {
    .history-stats { grid-template-columns: repeat(3,1fr); gap: 8px; }
    .history-grid { grid-template-columns: 1fr; }
  }
  ```

- [ ] **Step 4: Manual test — history page**

  1. Sign in with Google
  2. Analyze 2-3 articles
  3. Click avatar → "My History"
  4. Confirm: stats row shows correct counts, cards appear with outlet/headline/lean bar/score
  5. Click a card → drawer opens with full result
  6. Click "← Back" → returns to main view

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/history.js frontend/index.html frontend/style.css
  git commit -m "feat: add history dashboard with stats and card grid"
  ```

---

## Task 11: Stripe Setup & End-to-End Test

> Manual steps to wire up Stripe before deploying.

- [ ] **Step 1: Create Stripe product and price**

  In Stripe dashboard (dashboard.stripe.com):
  - Products → Add Product → name "Veris Pro"
  - Add price: Recurring, $7.99/month
  - Copy the **Price ID** (starts with `price_`)

- [ ] **Step 2: Set up Stripe webhook**

  In Stripe → Developers → Webhooks → Add endpoint:
  - URL: `https://your-railway-app.up.railway.app/stripe/webhook`
  - Events to listen for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
  - Copy the **Signing secret** (starts with `whsec_`)

- [ ] **Step 3: Set environment variables on Railway**

  In Railway dashboard → your backend service → Variables, add:
  ```
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_ID=price_...
  ```

- [ ] **Step 4: Deploy to Railway**

  ```bash
  git push origin main
  ```

  Watch Railway deploy logs — confirm the service starts without errors about missing env vars.

- [ ] **Step 5: End-to-end test**

  1. Visit veris.news
  2. Sign in with Google — confirm avatar appears
  3. Analyze an article — confirm it saves (check My History)
  4. Use Stripe test card `4242 4242 4242 4242` to subscribe
  5. Confirm quota jumps to 30/month
  6. Go to Account Settings → Delete account → confirm deletion clears session

---

## Task 12: Final Cleanup

- [ ] **Step 1: Tighten CORS in main.py**

  Replace `allow_origins=["*"]` with:
  ```python
  allow_origins=[
      "https://veris.news",
      "https://media-bias-analyzer.naik-alankar.workers.dev",
      "http://localhost:8787",
  ],
  ```

- [ ] **Step 2: Run full test suite**

  ```bash
  cd backend && source venv/bin/activate && python -m pytest tests/ -v
  ```

  Expected: all tests PASSED.

- [ ] **Step 3: Final commit**

  ```bash
  git add backend/main.py
  git commit -m "chore: tighten CORS to known frontend origins"
  git push origin main
  ```
