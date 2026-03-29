"""API routes — hub router that includes all sub-modules."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.chat import router as chat_router
from app.api.chat_calendar import router as calendar_chat_router
from app.api.chat_github import router as github_chat_router
from app.api.conversations import router as conversations_router
from app.api.settings_routes import router as settings_router
from app.api.neuron import router as neuron_router

router = APIRouter()

router.include_router(chat_router)
router.include_router(calendar_chat_router)
router.include_router(github_chat_router)
router.include_router(conversations_router)
router.include_router(settings_router)
router.include_router(neuron_router)
