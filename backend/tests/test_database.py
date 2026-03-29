"""Tests for database operations using in-memory SQLite."""

from __future__ import annotations

import pytest
import pytest_asyncio

import app.db.database as db_module


@pytest_asyncio.fixture(autouse=True)
async def test_db():
    """Set up an in-memory database for each test."""
    # Reset global connection
    db_module._db_connection = None
    # Override DB_PATH to use in-memory database
    original_db_path = db_module.DB_PATH
    db_module.DB_PATH = ":memory:"
    await db_module.init_db()
    yield
    # Close connection and restore
    if db_module._db_connection:
        await db_module._db_connection.close()
        db_module._db_connection = None
    db_module.DB_PATH = original_db_path


# ── Conversations ──


class TestConversations:
    @pytest.mark.asyncio
    async def test_create_conversation_returns_dict(self):
        conv = await db_module.create_conversation("Test Chat")
        assert conv["title"] == "Test Chat"
        assert "id" in conv
        assert conv["folder_id"] is None

    @pytest.mark.asyncio
    async def test_get_conversation_returns_created(self):
        conv = await db_module.create_conversation("My Chat")
        fetched = await db_module.get_conversation(conv["id"])
        assert fetched is not None
        assert fetched["title"] == "My Chat"
        assert fetched["id"] == conv["id"]

    @pytest.mark.asyncio
    async def test_get_nonexistent_conversation_returns_none(self):
        result = await db_module.get_conversation("nonexistent-id")
        assert result is None

    @pytest.mark.asyncio
    async def test_list_conversations_returns_all(self):
        await db_module.create_conversation("Chat 1")
        await db_module.create_conversation("Chat 2")
        convs = await db_module.list_conversations()
        assert len(convs) >= 2

    @pytest.mark.asyncio
    async def test_update_conversation_title(self):
        conv = await db_module.create_conversation("Old Title")
        await db_module.update_conversation_title(conv["id"], "New Title")
        fetched = await db_module.get_conversation(conv["id"])
        assert fetched["title"] == "New Title"

    @pytest.mark.asyncio
    async def test_delete_conversation(self):
        conv = await db_module.create_conversation("To Delete")
        await db_module.delete_conversation(conv["id"])
        fetched = await db_module.get_conversation(conv["id"])
        assert fetched is None


# ── Messages ──


class TestMessages:
    @pytest.mark.asyncio
    async def test_add_and_get_messages(self):
        conv = await db_module.create_conversation("Chat")
        msg = await db_module.add_message(conv["id"], "user", "Hello")
        assert msg["role"] == "user"
        assert msg["content"] == "Hello"

        messages = await db_module.get_messages(conv["id"])
        assert len(messages) == 1
        assert messages[0]["content"] == "Hello"

    @pytest.mark.asyncio
    async def test_messages_ordered_by_creation(self):
        conv = await db_module.create_conversation("Chat")
        await db_module.add_message(conv["id"], "user", "First")
        await db_module.add_message(conv["id"], "assistant", "Second")
        await db_module.add_message(conv["id"], "user", "Third")

        messages = await db_module.get_messages(conv["id"])
        assert len(messages) == 3
        assert messages[0]["content"] == "First"
        assert messages[1]["content"] == "Second"
        assert messages[2]["content"] == "Third"

    @pytest.mark.asyncio
    async def test_message_metadata_stored(self):
        conv = await db_module.create_conversation("Chat")
        msg = await db_module.add_message(
            conv["id"], "assistant", "Response",
            model="test-model",
            provider="openrouter",
            reasoning_strategy="cot",
            tokens_used=150,
        )
        assert msg["model"] == "test-model"
        assert msg["provider"] == "openrouter"
        assert msg["tokens_used"] == 150

    @pytest.mark.asyncio
    async def test_get_messages_for_empty_conversation(self):
        conv = await db_module.create_conversation("Empty")
        messages = await db_module.get_messages(conv["id"])
        assert messages == []

    @pytest.mark.asyncio
    async def test_add_message_updates_conversation_timestamp(self):
        conv = await db_module.create_conversation("Chat")
        old_updated = conv["updated_at"]
        await db_module.add_message(conv["id"], "user", "Hello")
        fetched = await db_module.get_conversation(conv["id"])
        assert fetched["updated_at"] >= old_updated


# ── Folders ──


class TestFolders:
    @pytest.mark.asyncio
    async def test_create_folder(self):
        folder = await db_module.create_folder("Work")
        assert folder["name"] == "Work"
        assert "id" in folder

    @pytest.mark.asyncio
    async def test_list_folders(self):
        await db_module.create_folder("Alpha")
        await db_module.create_folder("Beta")
        folders = await db_module.list_folders()
        names = [f["name"] for f in folders]
        assert "Alpha" in names
        assert "Beta" in names

    @pytest.mark.asyncio
    async def test_rename_folder(self):
        folder = await db_module.create_folder("Old Name")
        await db_module.rename_folder(folder["id"], "New Name")
        fetched = await db_module.get_folder(folder["id"])
        assert fetched["name"] == "New Name"

    @pytest.mark.asyncio
    async def test_delete_folder(self):
        folder = await db_module.create_folder("To Delete")
        await db_module.delete_folder(folder["id"])
        fetched = await db_module.get_folder(folder["id"])
        assert fetched is None

    @pytest.mark.asyncio
    async def test_delete_folder_moves_conversations_to_parent(self):
        folder = await db_module.create_folder("Parent")
        child = await db_module.create_folder("Child", parent_folder_id=folder["id"])
        conv = await db_module.create_conversation("Chat")
        await db_module.move_conversation_to_folder(conv["id"], child["id"])

        await db_module.delete_folder(child["id"])
        fetched_conv = await db_module.get_conversation(conv["id"])
        assert fetched_conv["folder_id"] == folder["id"]

    @pytest.mark.asyncio
    async def test_nested_folders(self):
        parent = await db_module.create_folder("Parent")
        child = await db_module.create_folder("Child", parent_folder_id=parent["id"])
        fetched = await db_module.get_folder(child["id"])
        assert fetched["parent_folder_id"] == parent["id"]


# ── Conversation Summaries (RAG) ──


class TestConversationSummaries:
    @pytest.mark.asyncio
    async def test_save_and_search_summary(self):
        conv = await db_module.create_conversation("Python Chat")
        await db_module.save_conversation_summary(
            conv["id"],
            "Discussed Python async patterns and FastAPI",
            "python, asyncio, fastapi, async, patterns",
        )
        results = await db_module.search_relevant_conversations(
            query_keywords=["python", "asyncio"],
        )
        assert len(results) >= 1
        assert results[0]["conversation_id"] == conv["id"]

    @pytest.mark.asyncio
    async def test_search_with_no_match(self):
        conv = await db_module.create_conversation("JS Chat")
        await db_module.save_conversation_summary(
            conv["id"],
            "Discussed JavaScript frameworks",
            "javascript, react, vue",
        )
        results = await db_module.search_relevant_conversations(
            query_keywords=["quantum", "physics", "hadron"],
        )
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_search_excludes_current_conversation(self):
        conv = await db_module.create_conversation("Chat")
        await db_module.save_conversation_summary(
            conv["id"], "Python discussion", "python",
        )
        results = await db_module.search_relevant_conversations(
            query_keywords=["python"],
            exclude_conversation_id=conv["id"],
        )
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_save_summary_upserts(self):
        conv = await db_module.create_conversation("Chat")
        await db_module.save_conversation_summary(conv["id"], "First summary", "key1")
        await db_module.save_conversation_summary(conv["id"], "Updated summary", "key2")
        results = await db_module.search_relevant_conversations(query_keywords=["key2"])
        assert len(results) == 1
        assert results[0]["summary"] == "Updated summary"


# ── Provider Settings ──


class TestProviderSettings:
    @pytest.mark.asyncio
    async def test_save_and_get_provider_settings(self):
        await db_module.save_provider_settings(
            "openrouter", "sk-test-key", "https://api.openrouter.ai", True,
        )
        settings = await db_module.get_provider_settings()
        assert len(settings) >= 1
        openrouter = next(s for s in settings if s["provider"] == "openrouter")
        assert openrouter["api_key"] == "sk-test-key"
        assert openrouter["enabled"] is True

    @pytest.mark.asyncio
    async def test_upsert_provider_settings(self):
        await db_module.save_provider_settings("test_provider", "key1", "", True)
        await db_module.save_provider_settings("test_provider", "key2", "", False)
        settings = await db_module.get_provider_settings()
        provider = next(s for s in settings if s["provider"] == "test_provider")
        assert provider["api_key"] == "key2"
        assert provider["enabled"] is False

    @pytest.mark.asyncio
    async def test_get_provider_key(self):
        await db_module.save_provider_settings("brave", "brave-key-123", "", True)
        key = await db_module.get_provider_key("brave")
        assert key == "brave-key-123"

    @pytest.mark.asyncio
    async def test_get_provider_key_disabled_returns_none(self):
        await db_module.save_provider_settings("disabled_prov", "key", "", False)
        key = await db_module.get_provider_key("disabled_prov")
        assert key is None

    @pytest.mark.asyncio
    async def test_provider_extra_json_parsed(self):
        await db_module.save_provider_settings(
            "custom", "key", "", True, extra={"model": "gpt-4"},
        )
        settings = await db_module.get_provider_settings()
        custom = next(s for s in settings if s["provider"] == "custom")
        assert custom["extra"]["model"] == "gpt-4"
