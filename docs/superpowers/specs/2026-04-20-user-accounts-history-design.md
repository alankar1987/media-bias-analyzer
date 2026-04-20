# Veris — User Accounts & History Design

**Date:** 2026-04-20  
**Status:** Approved for implementation

---

## Overview

Add user accounts, analysis history, and a subscription paywall to Veris. Logged-in users can save analyses, view a card-grid history dashboard with personal media diet stats, and subscribe for higher usage limits. Anonymous users get one trial analysis per session.

---

## Goals

- Let users sign up via Google OAuth and persist their analysis history
- Enforce a free tier (3 analyses/month) and a paid tier ($7.99/month, 30 analyses)
- Deter casual abuse with a 1-try anonymous session limit + IP rate limiting
- Show users a "media diet" summary (lean distribution, avg fact score) above their history

---

## Stack

| Layer | Technology |
|---|---|
| Auth + Database | Supabase (Google OAuth, Postgres, row-level security) |
| Payments | Stripe (subscription billing) |
| Backend | FastAPI on Railway (existing) |
| Frontend | Vanilla JS / HTML / CSS on Cloudflare Workers (existing) |

---

## Database Schema

### `users` (managed by Supabase Auth — no custom table needed)
Fields used: `id` (UUID), `email`, `created_at`

### `analyses`
```sql
create table analyses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  created_at   timestamptz default now(),
  url          text,
  source_name  text,
  headline     text,
  lean_label   text,
  lean_numeric smallint,
  fact_score   smallint,
  result_json  jsonb,       -- full API response
  article_text text         -- snapshot at time of analysis
);

create index on analyses(user_id, created_at desc);
alter table analyses enable row level security;
create policy "users see own rows" on analyses
  for all using (auth.uid() = user_id);
```

### `subscriptions`
```sql
create table subscriptions (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  stripe_customer  text unique,
  stripe_sub_id    text unique,
  status           text,   -- 'active' | 'canceled' | 'past_due'
  current_period_end timestamptz
);
alter table subscriptions enable row level security;
create policy "users see own row" on subscriptions
  for all using (auth.uid() = user_id);
```

---

## Quota Rules

| Tier | Monthly analyses | Logic |
|---|---|---|
| Anonymous | 1 per session (cookie) + 5/hour per IP | No account required |
| Free (logged in) | 3/month | Count rows in `analyses` for current calendar month |
| Paid | 30/month | Same count, higher cap |

Monthly window resets on calendar month boundary (not rolling 30 days).

---

## Backend Changes

### New environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never exposed to frontend)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID` (the $7.99/mo price ID)

### New routes

**`GET /auth/usage`** — requires JWT  
Returns `{ analyses_this_month: int, limit: int, tier: "free"|"paid" }`

**`POST /stripe/checkout`** — requires JWT  
Creates a Stripe Checkout session, returns `{ url: string }`

**`POST /stripe/webhook`** — Stripe webhook  
Handles `customer.subscription.updated` and `customer.subscription.deleted` events to sync `subscriptions` table

### Modified routes: `/analyze` and `/compare`

Both accept an optional `Authorization: Bearer <jwt>` header.

**If JWT present:**
1. Verify JWT with Supabase service role key
2. Look up subscription status
3. Count analyses this calendar month
4. If over limit → return 402 with `{ error: "quota_exceeded", tier, limit }`
5. Run analysis (existing logic)
6. Insert row into `analyses`
7. Return result

**If no JWT (anonymous):**
1. Check `veris_anon` session cookie — if set, return 429
2. Check IP rate limit (5/hour, in-memory with TTL) — if exceeded, return 429
3. Run analysis
4. Set `veris_anon` cookie (httpOnly, SameSite=Strict, 24h)
5. Return result

---

## Frontend Changes

### Auth UI
- "Sign in with Google" button in the site header (replaces nothing — just adds to header)
- On sign-in success: button changes to user avatar + "My History" link + "Sign out"
- Supabase JS client loaded via CDN, handles OAuth redirect and session persistence in localStorage

### Quota enforcement
- After each analysis, frontend checks the response for 402 status
- On 402: show upgrade modal ("You've used your 3 free analyses this month. Upgrade for 30/month.")
- Upgrade modal has a "Subscribe — $7.99/month" button that calls `/stripe/checkout` and redirects to Stripe

### History page (`/history`)
Implemented as a separate HTML section revealed on the same page (no new HTML file needed — toggle visibility like the compare mode).

**Layout: Stats row + Card grid**

Stats row (top):
- Total analyzed (count)
- Average lean (label, e.g. "Center-left")
- Average fact score (0–100)

Card grid below stats:
- Each card: outlet name, headline snippet, lean spectrum mini-bar with dot, fact score, date
- Cards sorted by `created_at desc`
- Click card → expand to show full result inline (same accordion components as analysis view)
- Load first 20, "Load more" button for pagination (20 at a time)

---

## Error Handling

| Scenario | Response |
|---|---|
| JWT expired/invalid | 401 — frontend clears session, prompts re-login |
| Quota exceeded | 402 — frontend shows upgrade modal |
| Anonymous limit hit | 429 — frontend shows "Sign up for free to save results and get 3 analyses/month" |
| Stripe checkout failure | Show error toast, don't lose analysis result |
| Supabase insert failure | Log server-side, don't fail the analysis response (save is best-effort) |

---

## Security

- `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` never sent to the frontend
- Row-level security on both tables — users can only read/write their own rows
- Stripe webhook validated with `STRIPE_WEBHOOK_SECRET` before processing
- Anonymous cookie is `httpOnly` and `SameSite=Strict` to prevent JS access and CSRF
- IP rate limiting uses in-memory store (sufficient for Railway single-instance; can move to Redis if scaling)

---

## Monetization Summary

| | Free | Paid |
|---|---|---|
| Price | $0 | $7.99/month |
| Analyses/month | 3 | 30 |
| API cost/month (est.) | ~$0.30 | ~$3.00 |
| Gross margin (paid) | — | ~62% |

Break-even: ~65 paid subscribers covers Railway + Supabase free tier + Stripe fees.

---

## Account Deletion (GDPR/CCPA)

Self-serve "Delete my account" button in account settings (no admin dashboard needed).

**Flow:**
1. User clicks "Delete my account" → confirmation modal ("This will permanently delete your history and cancel your subscription.")
2. Frontend calls `DELETE /auth/account` with JWT
3. Backend:
   - Cancels active Stripe subscription (if any) via `stripe.subscriptions.cancel`
   - Calls Supabase Admin API to delete the `auth.users` row
   - Cascade wipes `analyses` and `subscriptions` rows automatically
4. Frontend clears session, redirects to home

**Error handling:** If Stripe cancel fails, still delete the Supabase user (don't hold data hostage). Log the Stripe failure for manual follow-up.

---

## Out of Scope (this phase)

- Annual pricing
- Team/shared accounts
- Analysis sharing / shareable cards
- Browser extension
- Email notifications
- Admin dashboard
