"""RAG — Retrieval-Augmented Generation from past conversations.

Uses TF-IDF cosine similarity (numpy only, no heavy dependencies) for
semantic search over conversation summaries.

TRIZ Principle #26 "Copying": Instead of re-reading full conversations,
index compressed summaries and retrieve by semantic similarity.
"""

from __future__ import annotations

import logging
import math
import re
import uuid
from collections import Counter
from datetime import datetime, timezone

import numpy as np

from app.db import database as db
from app.providers.base import LLMMessage, LLMRequest

logger = logging.getLogger(__name__)

# ── Stop Words (RU + EN) ──

STOP_WORDS = frozenset([
    # Russian
    "это", "как", "что", "для", "при", "все", "они", "она",
    "его", "мне", "был", "быть", "есть", "были", "будет", "или",
    "так", "уже", "где", "кто", "чем", "если", "когда", "тоже",
    "только", "можно", "нужно", "надо", "может", "очень", "более",
    "также", "потому", "который", "которые", "которая", "которое",
    "чтобы", "после", "перед", "между", "через", "около", "вместе",
    # English
    "the", "and", "for", "that", "this", "with", "from", "have",
    "has", "was", "were", "are", "been", "being", "will", "would",
    "could", "should", "about", "which", "their", "there", "these",
    "those", "then", "than", "them", "they", "into", "some", "other",
    "more", "just", "also", "very", "when", "where", "what", "how",
    "not", "but", "can", "all", "each",
])


class SimpleVectorIndex:
    """Lightweight TF-IDF vector index for semantic search. No external dependencies beyond numpy."""

    def __init__(self):
        self.documents: list[dict] = []  # [{id, text, conversation_id, title, ...}]
        self.vocab: dict[str, int] = {}
        self.idf: np.ndarray | None = None
        self.tfidf_matrix: np.ndarray | None = None

    def add_document(self, doc_id: str, text: str, metadata: dict):
        """Add a document to the index."""
        self.documents.append({"id": doc_id, "text": text, **metadata})
        self._rebuild_index()

    def _tokenize(self, text: str) -> list[str]:
        """Simple word tokenization with stop word removal."""
        words = re.findall(r'\b\w{3,}\b', text.lower())
        return [w for w in words if w not in STOP_WORDS and len(w) < 30]

    def _rebuild_index(self):
        """Rebuild TF-IDF matrix from all documents."""
        if not self.documents:
            return

        # Build vocabulary
        all_tokens = [self._tokenize(doc["text"]) for doc in self.documents]
        vocab_set: set[str] = set()
        for tokens in all_tokens:
            vocab_set.update(tokens)
        self.vocab = {word: i for i, word in enumerate(sorted(vocab_set))}

        n_docs = len(self.documents)
        n_vocab = len(self.vocab)

        if n_vocab == 0:
            self.tfidf_matrix = None
            self.idf = None
            return

        # Compute TF (log-normalized)
        tf_matrix = np.zeros((n_docs, n_vocab))
        for i, tokens in enumerate(all_tokens):
            counter = Counter(tokens)
            for word, count in counter.items():
                if word in self.vocab:
                    tf_matrix[i, self.vocab[word]] = 1 + math.log(count) if count > 0 else 0

        # Compute IDF (smoothed)
        df = np.sum(tf_matrix > 0, axis=0)
        self.idf = np.log((n_docs + 1) / (df + 1)) + 1

        # TF-IDF
        self.tfidf_matrix = tf_matrix * self.idf

        # Normalize rows
        norms = np.linalg.norm(self.tfidf_matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self.tfidf_matrix /= norms

    def search(self, query: str, top_k: int = 3, exclude_conv_id: str | None = None) -> list[dict]:
        """Search for most similar documents by cosine similarity."""
        if self.tfidf_matrix is None or len(self.documents) == 0:
            return []

        tokens = self._tokenize(query)
        if not tokens:
            return []

        query_vec = np.zeros(len(self.vocab))
        for word in tokens:
            if word in self.vocab:
                query_vec[self.vocab[word]] = 1

        norm = np.linalg.norm(query_vec)
        if norm == 0:
            return []
        query_vec /= norm

        # Cosine similarity
        similarities = self.tfidf_matrix @ query_vec

        # Filter and sort
        results = []
        for i in np.argsort(similarities)[::-1]:
            doc = self.documents[i]
            if exclude_conv_id and doc.get("conversation_id") == exclude_conv_id:
                continue
            if similarities[i] < 0.05:
                break
            results.append({**doc, "score": float(similarities[i])})
            if len(results) >= top_k:
                break

        return results


# Module-level index, rebuilt from DB on first use
_vector_index: SimpleVectorIndex | None = None


async def get_vector_index() -> SimpleVectorIndex:
    """Get or build the vector index from DB summaries."""
    global _vector_index
    if _vector_index is not None:
        return _vector_index

    _vector_index = SimpleVectorIndex()
    # Load all summaries from DB
    summaries = await db.get_all_conversation_summaries()
    for s in summaries:
        _vector_index.add_document(
            doc_id=s["id"],
            text=f"{s['summary']} {s['keywords']}",
            metadata={
                "conversation_id": s["conversation_id"],
                "title": s.get("title", ""),
                "created_at": s.get("created_at", ""),
            },
        )
    return _vector_index


def invalidate_vector_index():
    """Force rebuild on next access (call after adding new summaries)."""
    global _vector_index
    _vector_index = None


# ── Summary Generation ──

SUMMARY_PROMPT = """Проанализируй этот диалог и создай краткое описание (2-3 предложения) и ключевые слова.

Формат ответа — строго JSON (без markdown):
{"summary": "краткое описание темы и результата беседы", "keywords": "ключевое1, ключевое2, ключевое3"}

Диалог:
{dialogue}"""


async def generate_conversation_summary(
    conversation_id: str,
    messages: list[LLMMessage],
    provider=None,
    model: str | None = None,
) -> dict | None:
    """Generate and store a summary for a conversation."""
    import json as _json

    if len(messages) < 3:
        return None

    relevant = [m for m in messages if m.role in ("user", "assistant")][-10:]
    if not relevant:
        return None

    dialogue = "\n".join(
        f"{'User' if m.role == 'user' else 'AI'}: {m.content[:300]}"
        for m in relevant
    )

    if not provider or not model:
        # Fallback: simple extractive summary
        user_msgs = [m.content for m in relevant if m.role == "user"]
        summary = "; ".join(msg[:100] for msg in user_msgs[:3])
        keywords = " ".join(summary.split()[:10])
    else:
        try:
            req = LLMRequest(
                messages=[
                    LLMMessage(role="user", content=SUMMARY_PROMPT.format(dialogue=dialogue)),
                ],
                model=model,
                temperature=0.0,
                max_tokens=200,
            )
            resp = await provider.complete(req)
            content = (resp.content or "").strip()
            # Strip markdown code fences
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)
            data = _json.loads(content)
            summary = data.get("summary", "")
            keywords = data.get("keywords", "")
        except Exception as e:
            logger.warning("Summary generation failed: %s", e)
            # Fallback
            user_msgs = [m.content for m in relevant if m.role == "user"]
            summary = "; ".join(msg[:100] for msg in user_msgs[:3])
            keywords = " ".join(summary.split()[:10])

    if not summary:
        return None

    # Save to DB
    result = await db.save_conversation_summary(conversation_id, summary, keywords)

    # Add to vector index
    index = await get_vector_index()
    conv = await db.get_conversation(conversation_id)
    title = conv.get("title", "") if conv else ""
    index.add_document(
        doc_id=result["id"],
        text=f"{summary} {keywords}",
        metadata={
            "conversation_id": conversation_id,
            "title": title,
            "created_at": result["created_at"],
        },
    )

    logger.info("Generated summary for conversation %s", conversation_id[:8])
    return result


# ── Retrieval ──

async def retrieve_relevant_context(
    query: str,
    exclude_conversation_id: str | None = None,
    limit: int = 3,
) -> str | None:
    """Retrieve relevant past conversation summaries using TF-IDF similarity."""
    index = await get_vector_index()
    results = index.search(query, top_k=limit, exclude_conv_id=exclude_conversation_id)

    if not results:
        return None

    # Format as context block
    parts = []
    for r in results:
        title = r.get("title", "Беседа")
        score = r.get("score", 0)
        text = r.get("text", "")
        parts.append(f"- [{title}] (релевантность: {score:.0%}): {text[:200]}")

    context = "Релевантные прошлые беседы:\n" + "\n".join(parts)
    return context
