"""Conversation & folder CRUD endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    ConversationCreate,
    ConversationMoveRequest,
    ConversationUpdate,
    FolderCreate,
    FolderMoveRequest,
    FolderUpdate,
)
from app.db import database as db

router = APIRouter()


# ── Conversations ──

@router.get("/api/conversations/search")
async def search_conversations(q: str = ""):
    """Search conversations by title or message content."""
    if not q or len(q) < 2:
        return []
    results = await db.search_conversations(q)
    return results


@router.get("/api/conversations")
async def list_conversations():
    return await db.list_conversations()


@router.get("/api/conversations/smart-folders")
async def smart_folders():
    """Return conversations grouped by dominant domain for smart folder view."""
    convs = await db.list_conversations()
    groups: dict[str, list] = {}
    for c in convs:
        domain = c.get("dominant_domain", "general") or "general"
        groups.setdefault(domain, []).append(c)
    return groups


@router.post("/api/conversations")
async def create_conversation(req: ConversationCreate):
    return await db.create_conversation(req.title)


@router.get("/api/conversations/{cid}")
async def get_conversation(cid: str):
    conv = await db.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Not found")
    return conv


@router.get("/api/conversations/{cid}/messages")
async def get_messages(cid: str):
    return await db.get_messages(cid)


@router.patch("/api/conversations/{cid}")
async def update_conversation(cid: str, req: ConversationUpdate):
    await db.update_conversation_title(cid, req.title)
    return {"ok": True}


@router.delete("/api/conversations/{cid}")
async def delete_conversation(cid: str):
    await db.delete_conversation(cid)
    # Also clean up session context if it exists
    from app.api.chat import _session_contexts
    _session_contexts.pop(cid, None)
    return {"ok": True}


@router.put("/api/conversations/{cid}/folder")
async def move_conversation(cid: str, req: ConversationMoveRequest):
    conv = await db.get_conversation(cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.move_conversation_to_folder(cid, req.folder_id)
    return {"ok": True}


# ── Folders ──

@router.get("/api/folders")
async def list_folders():
    return await db.list_folders()


@router.post("/api/folders")
async def create_folder(req: FolderCreate):
    return await db.create_folder(req.name, req.parent_folder_id)


@router.put("/api/folders/{fid}")
async def rename_folder(fid: str, req: FolderUpdate):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.rename_folder(fid, req.name)
    return {"ok": True}


@router.delete("/api/folders/{fid}")
async def delete_folder(fid: str):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.delete_folder(fid)
    return {"ok": True}


@router.put("/api/folders/{fid}/move")
async def move_folder(fid: str, req: FolderMoveRequest):
    folder = await db.get_folder(fid)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Prevent circular reference
    if req.parent_folder_id == fid:
        raise HTTPException(status_code=400, detail="Cannot move folder into itself")
    await db.move_folder(fid, req.parent_folder_id)
    return {"ok": True}
