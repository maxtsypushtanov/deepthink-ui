"""Pydantic models for API request/response validation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(max_length=100000)
    model: str = "google/gemini-3.1-flash-lite-preview"
    provider: str = "openrouter"
    reasoning_strategy: Literal["auto", "none", "cot", "budget_forcing", "best_of_n", "tree_of_thoughts", "persona_council", "rubber_duck", "socratic", "triz"] = "auto"
    # temperature: reserved for future use
    max_tokens: int = 4096
    # Strategy-specific params
    budget_rounds: int = Field(default=3, ge=1, le=10)
    best_of_n: int = Field(default=3, ge=2, le=7)
    tree_breadth: int = Field(default=3, ge=2, le=5)
    tree_depth: int = Field(default=2, ge=1, le=4)
    clarification_context: str | None = None
    calendar_mode: bool = False
    github_mode: bool = False
    # Predictive reasoning prefill — skip re-detection if provided by WS prefill
    pre_domain: str | None = None
    pre_strategy: str | None = None


class ConversationCreate(BaseModel):
    title: str = "New Chat"


class ConversationUpdate(BaseModel):
    title: str


class ConversationMoveRequest(BaseModel):
    folder_id: str | None = None


class FolderCreate(BaseModel):
    name: str
    parent_folder_id: str | None = None


class FolderUpdate(BaseModel):
    name: str


class FolderMoveRequest(BaseModel):
    parent_folder_id: str | None = None


class ProviderSettingsRequest(BaseModel):
    provider: str
    api_key: str
    base_url: str = ""
    enabled: bool = True
