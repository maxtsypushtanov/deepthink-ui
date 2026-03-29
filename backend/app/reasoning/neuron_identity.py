"""Neuron Identity System — three-layer self-awareness for the DeepThink agent.

Layers:
  1. identity_core  — static, loaded from neuron_core.json (never auto-overwritten)
  2. self_model     — dynamic self-understanding, consolidated every 10 conversations
  3. user_narrative — living story about the user, updated after every conversation
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.db import database as db
from app.providers.base import BaseLLMProvider, LLMRequest, LLMMessage

logger = logging.getLogger(__name__)

CORE_PATH = Path(__file__).resolve().parent.parent.parent / "neuron_core.json"

# How many conversations between self_model consolidation runs
CONSOLIDATION_INTERVAL = 10

# Cheap model for reflection calls (fast, cheap, good enough)
REFLECTION_MODEL = "google/gemini-2.0-flash-lite-001"


def _load_core() -> dict:
    """Load the static identity core from neuron_core.json."""
    try:
        return json.loads(CORE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Failed to load neuron_core.json: %s", e)
        return {"name": "Нейрон", "mission": "Помогать пользователю мыслить глубже"}


def _core_to_prompt(core: dict) -> str:
    """Format identity core as a system prompt block."""
    name = core.get("name", "Нейрон")
    mission = core.get("mission", "")
    character = core.get("character", {})
    values = core.get("values", {})
    agency = core.get("agency", "")

    char_lines = "\n".join(f"  — {v}" for v in character.values()) if isinstance(character, dict) else str(character)
    val_lines = "\n".join(f"  — {v}" for v in values.values()) if isinstance(values, dict) else str(values)

    return f"""ИДЕНТИЧНОСТЬ НЕЙРОНА:
Имя: {name}
Миссия: {mission}

Характер:
{char_lines}

Ценности:
{val_lines}

Право на инициативу: {agency}"""


class NeuronIdentityManager:
    """Manages the three-layer identity system for the Neuron agent."""

    def __init__(self):
        self._core: dict | None = None

    @property
    def core(self) -> dict:
        if self._core is None:
            self._core = _load_core()
        return self._core

    async def get_system_prompt_block(self) -> str:
        """Build the full identity block for injection into system prompts.

        Assembles all three layers into a single text block.
        """
        parts: list[str] = []

        # Layer 1: Static core (always present)
        parts.append(_core_to_prompt(self.core))

        # Layer 2: Self-model (if exists)
        self_model = await db.get_neuron_layer("self_model")
        if self_model and self_model["content"]:
            text = self_model["content"].get("text", "")
            if text:
                parts.append(f"САМОПОНИМАНИЕ НЕЙРОНА:\n{text}")

        # Layer 3: User narrative (if exists)
        narrative = await db.get_neuron_layer("user_narrative")
        if narrative and narrative["content"]:
            text = narrative["content"].get("text", "")
            if text:
                parts.append(f"КТО ЭТОТ ПОЛЬЗОВАТЕЛЬ (глазами Нейрона):\n{text}")

        return "\n\n".join(parts)

    async def load_full_identity(self) -> dict:
        """Return all three layers as a dict (for API/debug)."""
        layers = await db.get_all_neuron_layers()
        return {
            "identity_core": self.core,
            "self_model": layers.get("self_model", {}).get("content", {}),
            "user_narrative": layers.get("user_narrative", {}).get("content", {}),
            "meta": {
                "self_model_version": layers.get("self_model", {}).get("version"),
                "user_narrative_version": layers.get("user_narrative", {}).get("version"),
                "episode_count": await db.get_episode_count(),
            },
        }

    async def reflect_after_conversation(
        self,
        provider: BaseLLMProvider,
        conversation_id: str,
        messages: list[LLMMessage],
    ) -> None:
        """Post-conversation reflection — creates an episode and updates narrative.

        Runs as a background task, never blocks the user.
        """
        try:
            # Build a compact summary of the conversation
            summary_parts = []
            for m in messages[-20:]:  # last 20 messages max
                if m.role in ("user", "assistant") and isinstance(m.content, str):
                    prefix = "Пользователь" if m.role == "user" else "Нейрон"
                    text = m.content[:300]
                    summary_parts.append(f"{prefix}: {text}")
            summary = "\n".join(summary_parts)

            if not summary.strip():
                return

            # LLM reflection call
            reflection_prompt = f"""Ты — Нейрон, ИИ-агент платформы DeepThink.
Разговор с пользователем завершён. Вот краткое содержание:

{summary}

Ответь строго в JSON (без markdown-обёрток):
{{
  "episode_text": "осмысленный абзац — что произошло в этом разговоре, не список фактов",
  "self_insight": "что ты заметил о себе — своих паттернах, реакциях, качестве рассуждений",
  "user_insight": "что ты узнал о пользователе — как он думает, что его волнует, куда движется",
  "emotional_valence": число от -1.0 до 1.0,
  "importance": число от 0.0 до 1.0
}}"""

            resp = await provider.complete(LLMRequest(
                messages=[LLMMessage(role="user", content=reflection_prompt)],
                model=REFLECTION_MODEL,
                temperature=0.3,
                max_tokens=500,
                stream=False,
            ))

            # Parse response
            raw = resp.content.strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()

            data = json.loads(raw)

            # Save episode
            await db.add_neuron_episode(
                conversation_id=conversation_id,
                episode_text=data.get("episode_text", ""),
                self_insight=data.get("self_insight", ""),
                user_insight=data.get("user_insight", ""),
                emotional_valence=float(data.get("emotional_valence", 0.0)),
                importance=float(data.get("importance", 0.5)),
            )

            # Always update user narrative
            await self.update_user_narrative(provider)

            # Consolidate self-model every N conversations
            episode_count = await db.get_episode_count()
            if episode_count > 0 and episode_count % CONSOLIDATION_INTERVAL == 0:
                await self.consolidate_self_model(provider)

            logger.info("Neuron reflection complete for conversation %s", conversation_id)

        except Exception as e:
            logger.warning("Neuron reflection failed: %s", e)

    async def update_user_narrative(self, provider: BaseLLMProvider) -> None:
        """Aggregate recent episodes into a living narrative about the user."""
        try:
            episodes = await db.get_recent_episodes(limit=5)
            if not episodes:
                return

            insights = "\n".join(
                f"- {ep['user_insight']}" for ep in episodes if ep.get("user_insight")
            )
            if not insights.strip():
                return

            prompt = f"""Ты — Нейрон. Вот твои последние наблюдения о пользователе:

{insights}

Напиши единый связный нарратив (3-5 предложений) — не список фактов,
а живое описание: кто этот человек, как он мыслит, что для него важно,
куда он движется прямо сейчас."""

            resp = await provider.complete(LLMRequest(
                messages=[LLMMessage(role="user", content=prompt)],
                model=REFLECTION_MODEL,
                temperature=0.4,
                max_tokens=300,
                stream=False,
            ))

            narrative_text = resp.content.strip()
            if narrative_text:
                await db.upsert_neuron_layer("user_narrative", {"text": narrative_text})

        except Exception as e:
            logger.warning("User narrative update failed: %s", e)

    async def consolidate_self_model(self, provider: BaseLLMProvider) -> None:
        """Aggregate self-insights into an updated self-model."""
        try:
            insights = await db.get_self_insights(limit=20)
            if not insights:
                return

            insights_text = "\n".join(f"- {i}" for i in insights)

            prompt = f"""Ты — Нейрон. Вот твои наблюдения о себе за последнее время:

{insights_text}

Напиши обновлённую модель себя (4-6 предложений):
- В чём ты силён как агент рассуждений?
- Какие у тебя паттерны и склонности?
- Где ты ошибаешься или недорабатываешь?
- Что ты понял о своей миссии с этим конкретным пользователем?"""

            resp = await provider.complete(LLMRequest(
                messages=[LLMMessage(role="user", content=prompt)],
                model=REFLECTION_MODEL,
                temperature=0.4,
                max_tokens=400,
                stream=False,
            ))

            self_text = resp.content.strip()
            if self_text:
                await db.upsert_neuron_layer("self_model", {"text": self_text})
                logger.info("Neuron self-model consolidated (version +1)")

        except Exception as e:
            logger.warning("Self-model consolidation failed: %s", e)


# Singleton instance
identity_manager = NeuronIdentityManager()
