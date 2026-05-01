import os
import json
import logging
import re
from typing import Optional, Tuple

import httpx
from bs4 import BeautifulSoup
import trafilatura
import anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_client: Optional[anthropic.Anthropic] = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY environment variable is not set")
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


async def extract_text_from_url(url: str) -> Tuple[str, str]:
    """Fetch a URL and extract the article title and body text."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0),
        follow_redirects=True,
        headers=headers,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")

    title = ""
    if soup.title:
        title = soup.title.get_text(strip=True)
    elif soup.find("h1"):
        title = soup.find("h1").get_text(strip=True)

    for tag in soup(["script", "style", "nav", "footer", "header",
                     "aside", "iframe", "noscript", "form"]):
        tag.decompose()

    noise_pattern = re.compile(
        r"\b(nav|menu|sidebar|ad|banner|cookie|popup|modal|promo|related|share|social)\b",
        re.I,
    )
    for tag in soup.find_all(class_=noise_pattern):
        tag.decompose()
    for tag in soup.find_all(id=noise_pattern):
        tag.decompose()

    content = (
        soup.find("article")
        or soup.find(attrs={"role": "main"})
        or soup.find("main")
        or soup.find(
            class_=re.compile(
                r"\b(article|content|story|post|entry)([-_](body|text|content))?\b",
                re.I,
            )
        )
        or soup.find("body")
    )

    raw = content.get_text(separator="\n", strip=True) if content else ""
    lines = [ln.strip() for ln in raw.splitlines() if len(ln.strip()) > 30]
    cleaned = "\n".join(lines[:300])

    # Paywall heuristic: signals applied ONLY when extraction also failed to
    # find enough body text. Newsletter footers and "Subscribe" CTAs trip these
    # signals on plenty of fully-open articles (e.g., tribuneindia.com), so we
    # don't treat them as paywalled if the article body itself is present.
    _PAYWALL_SIGNALS = [
        "subscribe to read", "subscription required", "subscribers only",
        "sign in to read", "create an account to read", "premium content",
        "to continue reading", "continue reading with", "unlock this article",
        "already a subscriber", "get full access", "read the full story",
    ]

    if len(cleaned) < 200:
        # Try trafilatura on the already-fetched HTML (no extra network call)
        extracted = trafilatura.extract(response.text, include_comments=False, include_tables=False)
        if extracted and len(extracted.strip()) >= 200:
            cleaned = extracted.strip()
        else:
            # Body is truly short — now check whether paywall language is present.
            page_text_lower = response.text.lower()
            if any(signal in page_text_lower for signal in _PAYWALL_SIGNALS):
                raise ValueError(
                    "This article appears to be behind a paywall. "
                    "Please copy and paste the article text directly into the text box below."
                )
            # Last resort: Jina AI reader (extra network call, ~2-5s)
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as jina_client:
                jina_resp = await jina_client.get(f"https://r.jina.ai/{url}", headers={"Accept": "text/plain"})
                jina_text = jina_resp.text.strip()
            if len(jina_text) >= 200:
                cleaned = jina_text
            else:
                raise ValueError(
                    "Couldn't extract enough article text from this page — it may use "
                    "JavaScript rendering or have an unusual layout. "
                    "Please copy and paste the article text directly into the text box below."
                )

    return title, cleaned


_ANALYSIS_PROMPT = """\
You are an expert, nonpartisan media analyst. Carefully analyze the article \
below for political bias, sentiment, and factual accuracy. Use web search to \
verify key factual claims before producing your verdict.

{source_line}\
Article:
{text}

Return ONLY a valid JSON object — no markdown fences, no commentary — with \
this exact structure:
{{
  "political_lean": {{
    "score": <float -1.0 (far left) … 1.0 (far right)>,
    "label": "<far left|left|center-left|center|center-right|right|far right>",
    "numeric": <integer -10 to 10>,
    "confidence": "<low|medium|high>",
    "explanation": "<2-3 sentences on overall framing>",
    "framing_choices": [
      {{
        "quote": "<verbatim or near-verbatim quote from article>",
        "analysis": "<1-2 sentences on how this quote reveals bias or framing>",
        "lean": "<left|center|right>"
      }}
    ],
    "source_selection": {{
      "summary": "<1-2 sentences on the balance/imbalance of sources quoted>",
      "sources": ["<name of source or person quoted>"]
    }},
    "notable_omissions": ["<specific thing the article failed to mention>"]
  }},
  "sentiment": {{
    "score": <float -1.0 (very negative) … 1.0 (very positive)>,
    "label": "<very negative|negative|mixed|neutral|positive|very positive>",
    "numeric": <integer -100 to 100>,
    "explanation": "<1-2 sentences>"
  }},
  "fact_check": {{
    "score": <integer 0-100>,
    "summary": "<1-2 sentence overall assessment of factual accuracy>",
    "claims": [
      {{
        "claim": "<exact or near-exact claim from article>",
        "verdict": "<supported|disputed|unverifiable>",
        "explanation": "<1-2 sentences citing evidence>"
      }}
    ]
  }},
  "title": "<5-8 word descriptive title of the analysis, naming the topic and key framing — e.g. 'Reuters Climate Coverage Leans Center-Left' or 'Fox News Frames Immigration Critically'>",
  "summary": "<2-3 sentence objective summary of the article>",
  "article_type": "<news report|opinion|analysis|editorial|feature>",
  "broaden_your_view": [
    {{
      "outlet": "<name of a real news outlet>",
      "perspective": "<conservative|liberal|international|independent|local>",
      "angle": "<how this outlet would likely frame the same story differently>",
      "why": "<why reading this would broaden the reader's understanding>"
    }}
  ]
}}

Requirements:
- framing_choices: identify 2-3 specific quotes with analysis
- source_selection.sources: list actual names found in the article
- notable_omissions: list 2-3 concrete things missing
- fact_check.claims: identify and verify 3-5 key claims via web search
- broaden_your_view: suggest 3 real, distinct outlets from different perspectives
- Return ONLY the JSON, no other text
"""


def analyze_content(text: str, url: Optional[str] = None) -> dict:
    """
    Send article text to Claude (with web search) and return a structured
    analysis dict. Raises ValueError on parse failure, RuntimeError on
    configuration problems.
    """
    client = get_client()

    source_line = f"Source URL: {url}\n\n" if url else ""
    prompt = _ANALYSIS_PROMPT.format(
        source_line=source_line,
        text=text[:8000],
    )

    messages = [{"role": "user", "content": prompt}]
    tools = [{"type": "web_search_20250305", "name": "web_search"}]

    MAX_ITERATIONS = 10
    response = None

    for iteration in range(MAX_ITERATIONS):
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            tools=tools,
            messages=messages,
        )

        logger.info(
            "Claude iteration %d — stop_reason=%s, blocks=%d",
            iteration + 1,
            response.stop_reason,
            len(response.content),
        )

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            tool_results = [
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "",
                }
                for block in response.content
                if block.type == "tool_use"
            ]
            if tool_results:
                messages.append({"role": "user", "content": tool_results})
            continue

        logger.warning("Unexpected stop_reason: %s", response.stop_reason)
        break

    if response is None:
        raise ValueError("No response received from Claude")

    result_text = "".join(
        block.text for block in response.content if hasattr(block, "text")
    )

    if not result_text.strip():
        raise ValueError("Claude returned an empty response")

    start = result_text.find("{")
    end = result_text.rfind("}") + 1
    if start == -1 or end <= start:
        raise ValueError(f"No JSON object found in response: {result_text[:200]}")

    try:
        result = json.loads(result_text[start:end])
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON from Claude: {exc}") from exc

    required = {"political_lean", "sentiment", "fact_check", "summary"}
    missing = required - set(result.keys())
    if missing:
        raise ValueError(f"Analysis response is missing fields: {missing}")

    return result
