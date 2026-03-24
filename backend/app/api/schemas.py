"""Pydantic models for API request/response validation."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    model: str = "openai/gpt-4o-mini"
    provider: str = "openrouter"
    reasoning_strategy: str = "auto"
    temperature: float = 0.7
    max_tokens: int = 4096
    # Strategy-specific params
    budget_rounds: int = Field(default=3, ge=1, le=10)
    best_of_n: int = Field(default=3, ge=2, le=7)
    tree_breadth: int = Field(default=3, ge=2, le=5)
    tree_depth: int = Field(default=2, ge=1, le=4)
    clarification_context: str | None = None
    calendar_mode: bool = False


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


class ConversationResponse(BaseModel):
    id: str
    title: str
    folder_id: str | None = None
    created_at: str
    updated_at: str


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    model: str | None = None
    provider: str | None = None
    reasoning_strategy: str | None = None
    reasoning_trace: str | None = None
    tokens_used: int = 0
    created_at: str
