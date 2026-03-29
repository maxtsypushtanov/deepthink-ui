"""Tests for the smart model router."""

from __future__ import annotations

import pytest

from app.reasoning.model_router import (
    select_model,
    DEFAULT_MODEL_TIERS,
    FRONTEND_DEFAULT_MODEL,
)


class TestSelectModel:
    def test_complexity_1_selects_fast_tier(self):
        model, tier = select_model(1, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "fast"
        assert model == DEFAULT_MODEL_TIERS["fast"]

    def test_complexity_2_selects_fast_tier(self):
        model, tier = select_model(2, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "fast"

    def test_complexity_3_selects_standard_tier(self):
        model, tier = select_model(3, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "standard"
        assert model == DEFAULT_MODEL_TIERS["standard"]

    def test_complexity_4_selects_powerful_tier(self):
        model, tier = select_model(4, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "powerful"
        assert model == DEFAULT_MODEL_TIERS["powerful"]

    def test_complexity_5_selects_powerful_tier(self):
        model, tier = select_model(5, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "powerful"

    def test_math_domain_bumps_to_powerful_at_complexity_3(self):
        model, tier = select_model(3, "mathematics", FRONTEND_DEFAULT_MODEL)
        assert tier == "powerful"
        assert model == DEFAULT_MODEL_TIERS["powerful"]

    def test_software_engineering_bumps_to_powerful_at_complexity_3(self):
        model, tier = select_model(3, "software_engineering", FRONTEND_DEFAULT_MODEL)
        assert tier == "powerful"

    def test_general_domain_no_bump_at_complexity_3(self):
        model, tier = select_model(3, "general", FRONTEND_DEFAULT_MODEL)
        assert tier == "standard"

    def test_math_domain_no_bump_below_complexity_3(self):
        model, tier = select_model(2, "mathematics", FRONTEND_DEFAULT_MODEL)
        assert tier == "fast"

    def test_user_override_respected(self):
        custom_model = "anthropic/claude-3-opus"
        model, tier = select_model(3, "general", custom_model)
        assert model == custom_model
        assert tier == "user_override"

    def test_user_override_with_empty_model_uses_routing(self):
        model, tier = select_model(3, "general", "")
        assert tier == "standard"

    def test_user_model_same_as_tier_model_is_auto(self):
        """If user selected a tier model, treat as auto-routing."""
        model, tier = select_model(1, "general", DEFAULT_MODEL_TIERS["powerful"])
        # The user_model is in tier_models, so auto-routing applies
        assert tier == "fast"

    def test_custom_tiers_respected(self):
        custom_tiers = {
            "fast": "custom/fast-model",
            "standard": "custom/standard-model",
            "powerful": "custom/powerful-model",
        }
        model, tier = select_model(3, "general", FRONTEND_DEFAULT_MODEL, tiers=custom_tiers)
        assert tier == "standard"
        assert model == "custom/standard-model"

    def test_complexity_5_math_still_powerful(self):
        model, tier = select_model(5, "mathematics", FRONTEND_DEFAULT_MODEL)
        assert tier == "powerful"
