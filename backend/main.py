import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, model_validator
from dotenv import load_dotenv

from analyzer import extract_text_from_url, analyze_content
from auth import verify_jwt, get_quota, QuotaInfo
from db import save_analysis, get_history, get_analysis, delete_user as db_delete_user
import stripe_client
from rate_limit import get_limiter, ANON_COOKIE_NAME

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

MIN_TEXT_LENGTH = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Media Bias Analyzer — startup")
    yield
    logger.info("Media Bias Analyzer — shutdown")


app = FastAPI(
    title="Media Bias Analyzer",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://veris.news",
        "https://media-bias-analyzer.naik-alankar.workers.dev",
        "http://localhost:8787",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        url = (self.url or "").strip()
        text = (self.text or "").strip()
        if not url and not text:
            raise ValueError("Provide at least one of 'url' or 'text'.")
        self.url = url or None
        self.text = text or None
        return self


class AnalyzeResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    source_url: Optional[str] = None
    text_preview: Optional[str] = None


class CompareRequest(BaseModel):
    article1: AnalyzeRequest
    article2: AnalyzeRequest


class CompareResponse(BaseModel):
    success: bool
    article1: Optional[AnalyzeResponse] = None
    article2: Optional[AnalyzeResponse] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _process_single(req: AnalyzeRequest) -> AnalyzeResponse:
    """Extract and analyse one article. Never raises — errors go in the response."""
    article_text = req.text
    source_url = req.url

    if source_url:
        try:
            title, extracted = await extract_text_from_url(source_url)
            if not article_text:
                article_text = f"{title}\n\n{extracted}".strip() if title else extracted
            logger.info("Extracted %d chars from %s", len(extracted), source_url)
        except ValueError as exc:
            return AnalyzeResponse(success=False, error=str(exc), source_url=source_url)
        except Exception as exc:
            return AnalyzeResponse(
                success=False,
                error=f"Could not extract content from URL: {exc}",
                source_url=source_url,
            )

    if not article_text or len(article_text.strip()) < MIN_TEXT_LENGTH:
        return AnalyzeResponse(
            success=False,
            error=f"Article text must be at least {MIN_TEXT_LENGTH} characters.",
            source_url=source_url,
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, analyze_content, article_text, source_url)
    except (ValueError, RuntimeError) as exc:
        return AnalyzeResponse(success=False, error=str(exc), source_url=source_url)
    except Exception as exc:
        logger.error("Unexpected analysis error: %s", exc, exc_info=True)
        return AnalyzeResponse(
            success=False,
            error="Analysis failed. Please try again.",
            source_url=source_url,
        )

    preview_len = 300
    preview = (
        article_text[:preview_len] + "…"
        if len(article_text) > preview_len
        else article_text
    )
    return AnalyzeResponse(
        success=True,
        data=result,
        source_url=source_url,
        text_preview=preview,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["ops"])
async def health():
    return {"status": "ok"}


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
    clamped = min(limit, 50)
    rows = get_history(user_id=user["id"], offset=offset, limit=clamped)
    return {"items": rows, "offset": offset, "limit": clamped}


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


@app.delete("/auth/account", tags=["auth"])
async def delete_account(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        user = verify_jwt(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        stripe_client.cancel_subscription(user_id=user["id"])
    except Exception as exc:
        logger.warning("Stripe cancel failed for %s during deletion: %s", user["id"], exc)
    db_delete_user(user_id=user["id"])
    return {"deleted": True}


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

    if user is None:
        jr = JSONResponse(content={
            "success": r1.success and r2.success,
            "article1": r1.model_dump(),
            "article2": r2.model_dump(),
        })
        jr.set_cookie(key=ANON_COOKIE_NAME, value="1", max_age=86400, httponly=True, samesite="strict")
        return jr

    return CompareResponse(success=r1.success and r2.success, article1=r1, article2=r2)


# ---------------------------------------------------------------------------
# Global error handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def _global_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s: %s", request.method, request.url, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"},
    )
