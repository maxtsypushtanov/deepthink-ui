"""Smart model routing based on query complexity and domain.

Automatically selects the optimal model tier (fast / standard / powerful)
based on the heuristic complexity score and detected domain.
If the user manually chose a non-default model, their choice is respected.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Default model for each tier — user can override via settings
DEFAULT_MODEL_TIERS: dict[str, str] = {
    "fast": "google/gemini-3.1-flash-lite-preview",       # complexity 1-2: simple facts, greetings
    "standard": "google/gemini-2.5-flash-preview",         # complexity 3: moderate reasoning
    "powerful": "google/gemini-2.5-pro-preview",           # complexity 4-5: deep analysis
}

# The default model that the frontend sends when the user hasn't changed it
FRONTEND_DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview"

# Domains that deserve a bump to the powerful tier at complexity >= 3
POWERFUL_DOMAINS = {"mathematics", "software_engineering"}


def select_model(
    complexity: int,
    domain: str,
    user_model: str,
    tiers: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Select optimal model based on complexity.

    If user explicitly chose a specific model (not the default), respect their choice.
    Otherwise, route based on complexity.

    Returns:
        (selected_model, tier_name) — e.g. ("google/gemini-2.5-pro-preview", "powerful")
    """
    effective_tiers = tiers or DEFAULT_MODEL_TIERS

    # If user manually selected a non-default model, respect their choice
    if user_model and user_model != FRONTEND_DEFAULT_MODEL:
        # Check if the user model is one of the tier models — if so, treat as auto
        tier_models = set(effective_tiers.values())
        if user_model not in tier_models:
            logger.info(
                "Пользователь выбрал модель %s вручную — маршрутизация пропущена",
                user_model,
            )
            return user_model, "user_override"

    # Domain-based bump: math and software engineering get powerful tier at complexity >= 3
    if domain in POWERFUL_DOMAINS and complexity >= 3:
        model = effective_tiers.get("powerful", DEFAULT_MODEL_TIERS["powerful"])
        logger.info(
            "Маршрутизация: complexity=%d, domain=%s -> powerful (домен-бамп)",
            complexity, domain,
        )
        return model, "powerful"

    # Complexity-based routing
    if complexity <= 2:
        tier = "fast"
    elif complexity == 3:
        tier = "standard"
    else:
        tier = "powerful"

    model = effective_tiers.get(tier, DEFAULT_MODEL_TIERS.get(tier, user_model))
    logger.info(
        "Маршрутизация: complexity=%d, domain=%s -> %s (%s)",
        complexity, domain, tier, model,
    )
    return model, tier
