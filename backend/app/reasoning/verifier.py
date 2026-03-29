"""Post-generation fact verification via web search.

After an answer is generated, extract verifiable factual claims
(dates, numbers, named entities, events) and check them against
Brave Search results. Runs asynchronously — never blocks streaming.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Max claims to verify per response (keeps latency low)
MAX_CLAIMS = 3

# Domains where verification makes sense (factual content)
VERIFIABLE_DOMAINS = {
    "general", "science", "medicine", "law", "finance",
    "business", "mathematics", "software_engineering",
}

# Domains to SKIP verification (subjective / creative)
SKIP_VERIFICATION_DOMAINS = {
    "creative_writing", "philosophy",
}

# ── Claim extraction patterns ──

# Dates: "в 1969 году", "15 марта 2024", "founded in 1998"
_DATE_PATTERN = re.compile(
    r'(?:'
    r'в\s+(\d{4})\s*(?:г(?:оду|\.)?)?'                        # в 1969 году
    r'|\b(\d{1,2})\s+(?:января|февраля|марта|апреля|мая|июня'
    r'|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})'  # 15 марта 2024
    r'|(?:in|since|from|founded|established)\s+(\d{4})'         # founded in 1998
    r')',
    re.IGNORECASE,
)

# Numbers with context: "население 146 млн", "стоит $299", "расстояние 384 400 км"
_NUMBER_PATTERN = re.compile(
    r'(?:'
    r'(\d[\d\s,.]+)\s*(?:млн|млрд|тыс|км|м|кг|л|руб|долл|\$|€|%|человек|жител)'
    r'|(?:равн[оа]|составля\w+|около|примерно|порядка)\s+(\d[\d\s,.]+)'
    r')',
    re.IGNORECASE,
)

# Named entity claims: "столица X — Y", "X изобрёл Y", "X основал Y"
_ENTITY_PATTERN = re.compile(
    r'(?:'
    r'столиц[аы]\s+[\w\s]+\s*[—–-]\s*([\w\s]+)'
    r'|(?:основ(?:ал|ала|ано|атель)|изобр[её](?:л|ла|тён|татель)|открыл[аи]?|создал[аи]?)\s+([\w\s«»"]+)'
    r')',
    re.IGNORECASE,
)


def extract_claims(response_text: str) -> list[str]:
    """Extract verifiable factual claims from response text.

    Returns a list of short claim strings suitable for web search queries.
    """
    claims: list[str] = []

    # Strategy: extract sentences containing dates, numbers, or named entities
    sentences = re.split(r'[.!?\n]', response_text)

    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) < 15 or len(sentence) > 300:
            continue

        has_date = _DATE_PATTERN.search(sentence)
        has_number = _NUMBER_PATTERN.search(sentence)
        has_entity = _ENTITY_PATTERN.search(sentence)

        if has_date or has_number or has_entity:
            # Clean up the claim for search
            claim = re.sub(r'\s+', ' ', sentence).strip()
            # Remove markdown formatting
            claim = re.sub(r'[*_`#\[\]]', '', claim)
            if claim and len(claim) > 10:
                claims.append(claim)

        if len(claims) >= MAX_CLAIMS * 2:
            break

    # Deduplicate and limit
    seen = set()
    unique: list[str] = []
    for c in claims:
        key = c.lower()[:50]
        if key not in seen:
            seen.add(key)
            unique.append(c)

    return unique[:MAX_CLAIMS]


def _check_claim_against_results(
    claim: str,
    search_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Check if search results support or contradict a claim.

    Uses simple keyword overlap heuristic.
    """
    claim_lower = claim.lower()
    # Extract key terms (numbers, proper nouns, dates)
    key_terms = set()

    # Numbers
    for m in re.finditer(r'\d+', claim):
        key_terms.add(m.group())

    # Capitalized words (named entities) — both Russian and Latin
    for m in re.finditer(r'[А-ЯA-Z][а-яa-zА-ЯA-Z]+', claim):
        if len(m.group()) > 2:
            key_terms.add(m.group().lower())

    if not key_terms:
        return {"claim": claim, "status": "unverified", "source": "", "reason": "нет ключевых терминов"}

    best_score = 0.0
    best_source = ""
    best_snippet = ""
    contradiction_found = False

    for result in search_results:
        text = f"{result.get('title', '')} {result.get('description', '')}".lower()
        url = result.get("url", "")

        # Count how many key terms appear in the result
        matches = sum(1 for term in key_terms if term in text)
        score = matches / len(key_terms) if key_terms else 0

        if score > best_score:
            best_score = score
            best_source = url
            best_snippet = result.get("description", "")[:200]

    if best_score >= 0.6:
        return {"claim": claim, "status": "verified", "source": best_source, "snippet": best_snippet}
    elif best_score >= 0.3:
        return {"claim": claim, "status": "unverified", "source": best_source, "snippet": best_snippet}
    else:
        return {"claim": claim, "status": "unverified", "source": "", "snippet": ""}


async def verify_response(
    response_text: str,
    user_query: str,
    brave_api_key: str,
    domain: str = "general",
) -> dict[str, Any]:
    """Extract verifiable claims from response and check them via web search.

    Args:
        response_text: The generated LLM response.
        user_query: Original user question (for context).
        brave_api_key: Brave Search API key.
        domain: Detected domain of the query.

    Returns:
        {
            "verified": True/False,  — overall assessment
            "claims": [
                {"claim": "...", "status": "verified|unverified|contradicted", "source": "url"},
            ],
            "confidence_adjustment": float  — from -0.3 to +0.1
        }
    """
    from app.tools.web_search import brave_search

    # Skip for non-factual domains
    if domain in SKIP_VERIFICATION_DOMAINS:
        return {
            "verified": True,
            "claims": [],
            "confidence_adjustment": 0.0,
            "skipped": True,
            "reason": "Пропущено: субъективный/творческий домен",
        }

    # Extract claims
    claims = extract_claims(response_text)
    if not claims:
        return {
            "verified": True,
            "claims": [],
            "confidence_adjustment": 0.0,
            "skipped": True,
            "reason": "Нет фактических утверждений для проверки",
        }

    logger.info("Верификация: найдено %d утверждений для проверки", len(claims))

    verified_claims: list[dict[str, Any]] = []

    for claim in claims:
        try:
            # Search for the claim
            search_data = await brave_search(claim, brave_api_key, count=3)
            results = search_data.get("results", [])

            # Also include infobox if present
            if search_data.get("infobox"):
                ib = search_data["infobox"]
                results.insert(0, {
                    "title": ib.get("title", ""),
                    "url": ib.get("url", ""),
                    "description": ib.get("description", ""),
                })

            result = _check_claim_against_results(claim, results)
            verified_claims.append(result)

        except Exception as e:
            logger.warning("Ошибка проверки утверждения '%s': %s", claim[:50], e)
            verified_claims.append({
                "claim": claim,
                "status": "unverified",
                "source": "",
                "reason": f"Ошибка поиска: {str(e)[:100]}",
            })

    # Calculate overall verdict
    verified_count = sum(1 for c in verified_claims if c["status"] == "verified")
    contradicted_count = sum(1 for c in verified_claims if c["status"] == "contradicted")
    total = len(verified_claims)

    if total == 0:
        overall_verified = True
        confidence_adj = 0.0
    elif contradicted_count > 0:
        overall_verified = False
        confidence_adj = -0.3 * (contradicted_count / total)
    elif verified_count == total:
        overall_verified = True
        confidence_adj = 0.1
    elif verified_count >= total / 2:
        overall_verified = True
        confidence_adj = 0.05
    else:
        overall_verified = False
        confidence_adj = -0.1

    return {
        "verified": overall_verified,
        "claims": verified_claims,
        "confidence_adjustment": round(confidence_adj, 2),
    }
