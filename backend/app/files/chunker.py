"""Stage 2 — Route: size check + chunking for large files."""

from __future__ import annotations

import re

FULL_CONTEXT_THRESHOLD = 100_000  # characters
CHUNK_SIZE = 3000  # characters (~750 tokens)
CHUNK_OVERLAP = 500  # characters overlap


def should_chunk(char_count: int) -> bool:
    """Return True if the file is too large for full context injection."""
    return char_count >= FULL_CONTEXT_THRESHOLD


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Split text into overlapping chunks.

    Returns list of {"index": int, "text": str, "start": int, "end": int}.
    """
    chunks = []
    start = 0
    idx = 0
    while start < len(text):
        end = start + chunk_size

        # Try to break at a paragraph or sentence boundary
        if end < len(text):
            # Look for paragraph break near the end
            para_break = text.rfind("\n\n", start + chunk_size // 2, end + 200)
            if para_break > start:
                end = para_break + 2
            else:
                # Look for sentence break
                sent_break = _find_sentence_break(text, start + chunk_size // 2, end + 100)
                if sent_break > start:
                    end = sent_break

        chunk_text_str = text[start:end].strip()
        if chunk_text_str:
            chunks.append({
                "index": idx,
                "text": chunk_text_str,
                "start": start,
                "end": min(end, len(text)),
            })
            idx += 1

        start = max(start + 1, end - overlap)

    return chunks


def search_chunks(chunks: list[dict], query: str, top_k: int = 5) -> list[dict]:
    """Simple keyword-based search over chunks (no embeddings needed).

    Scores each chunk by keyword overlap with the query.
    Returns top-k chunks sorted by relevance.
    """
    query_words = set(re.findall(r'\w{3,}', query.lower()))
    if not query_words:
        return chunks[:top_k]

    scored = []
    for chunk in chunks:
        chunk_words = set(re.findall(r'\w{3,}', chunk["text"].lower()))
        overlap = len(query_words & chunk_words)
        # Boost by density: overlap / total words in chunk
        density = overlap / max(len(chunk_words), 1)
        score = overlap + density * 10
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]


def _find_sentence_break(text: str, start: int, end: int) -> int:
    """Find the last sentence-ending punctuation between start and end."""
    best = -1
    for m in re.finditer(r'[.!?]\s', text[start:end]):
        best = start + m.end()
    return best
