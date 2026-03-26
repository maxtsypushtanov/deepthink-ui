"""Document Cognitive Map — 3-level representation for intelligent document navigation.

TRIZ #13 "The Other Way Around": instead of fitting the document into the model's
context window, make the model navigate the document like a human expert would.

Level 0 — Skeleton: headings, structure, metadata (~50 tokens). Built at upload, no LLM.
Level 1 — Section Map: 1-2 sentence summary per section (~300 tokens). Built once via LLM, cached.
Level 2 — Full Text: only the sections relevant to the user's question. Loaded on demand.

Result: 10x fewer tokens per query, deeper analysis, unlimited document size.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Section:
    """A structural section of a document."""
    index: int
    title: str
    text: str
    start_char: int
    end_char: int
    level: int = 0  # heading depth (0 = top)
    summary: str = ""  # Level 1 summary, filled lazily


@dataclass
class CognitiveMap:
    """3-level document representation."""
    filename: str
    file_type: str
    total_chars: int
    sections: list[Section] = field(default_factory=list)
    skeleton: str = ""  # Level 0: compact structural overview
    section_map: str = ""  # Level 1: section summaries
    table_profile: str | None = None  # Table Intelligence profile (xlsx/csv)
    _summaries_built: bool = False

    def level0(self) -> str:
        """~50 tokens. Structure only."""
        return self.skeleton

    def level1(self) -> str:
        """~300 tokens. Section summaries."""
        if self.section_map:
            return self.section_map
        # Fallback to skeleton if summaries not built yet
        return self.skeleton

    def level2(self, section_indices: list[int]) -> str:
        """Full text of selected sections only."""
        parts = []
        for idx in section_indices:
            if 0 <= idx < len(self.sections):
                s = self.sections[idx]
                parts.append(f"### [{s.index}] {s.title}\n{s.text}")
        return "\n\n".join(parts)

    def find_relevant_sections(self, query: str, top_k: int = 3) -> list[int]:
        """Find sections most relevant to the query using keyword overlap."""
        query_words = set(re.findall(r'\w{3,}', query.lower()))
        if not query_words:
            return list(range(min(top_k, len(self.sections))))

        scored = []
        for s in self.sections:
            section_words = set(re.findall(r'\w{3,}', (s.title + " " + s.text[:500]).lower()))
            # Title match is 3x more important
            title_words = set(re.findall(r'\w{3,}', s.title.lower()))
            title_overlap = len(query_words & title_words) * 3
            text_overlap = len(query_words & section_words)
            score = title_overlap + text_overlap
            scored.append((score, s.index))

        scored.sort(reverse=True)
        return [idx for _, idx in scored[:top_k]]


# ── Builders ──

def build_cognitive_map(text: str, filename: str, file_type: str) -> CognitiveMap:
    """Build Level 0 (skeleton) + section split from raw text. No LLM needed."""
    total_chars = len(text)

    # For tables (xlsx, csv): use Table Intelligence for smart profiling
    table_profile_text: str | None = None
    if file_type in ("xlsx", "xls"):
        try:
            from app.files.table_intel import profile_excel_text
            profiles = profile_excel_text(text)
            table_profile_text = "\n\n".join(p.to_prompt() for p in profiles)
        except Exception as e:
            logger.warning("Table profiling failed: %s", e)

    # Split into sections based on file type
    if file_type == "code":
        sections = _split_code(text)
    elif file_type in ("pdf", "pptx"):
        sections = _split_by_page_markers(text)
    elif file_type in ("xlsx", "xls"):
        sections = _split_by_sheet_markers(text)
    else:
        # CSV: try table profiling too
        if file_type == "text" and ('|' in text[:200] or ',' in text[:200]) and '\n' in text[:500]:
            try:
                from app.files.table_intel import profile_table_from_text
                profile = profile_table_from_text(text)
                if profile.rows > 5:
                    table_profile_text = profile.to_prompt()
            except Exception:
                pass
        sections = _split_by_headings(text)

    # If no sections found, create one section for the whole document
    if not sections:
        sections = [Section(index=0, title="Документ целиком", text=text, start_char=0, end_char=total_chars)]

    # Build skeleton (Level 0)
    skeleton_parts = [f"Файл: {filename} ({file_type}, {total_chars:,} символов, {len(sections)} секций)"]
    for s in sections:
        char_info = f"{len(s.text):,} симв."
        skeleton_parts.append(f"  [{s.index}] {s.title} ({char_info})")
    skeleton = "\n".join(skeleton_parts)

    cmap = CognitiveMap(
        filename=filename,
        file_type=file_type,
        total_chars=total_chars,
        sections=sections,
        skeleton=skeleton,
    )

    # Attach table profile if available — replaces raw text for tables
    if table_profile_text:
        cmap.table_profile = table_profile_text

    return cmap


async def build_section_summaries(
    cmap: CognitiveMap,
    provider,
    model: str,
) -> None:
    """Build Level 1 summaries for each section via LLM. Called once, cached."""
    if cmap._summaries_built:
        return

    from app.providers.base import LLMMessage, LLMRequest

    summaries = []
    for s in cmap.sections:
        # Skip very short sections
        if len(s.text) < 50:
            s.summary = s.title
            summaries.append(f"[{s.index}] {s.title}: {s.title}")
            continue

        # Truncate very long sections for summarization
        text_for_summary = s.text[:2000]
        req = LLMRequest(
            messages=[LLMMessage(role="user", content=(
                f"Опиши содержание этой секции документа в 1-2 предложениях. "
                f"Только факты, без вводных слов.\n\n"
                f"Секция «{s.title}»:\n{text_for_summary}"
            ))],
            model=model,
            temperature=0.0,
            max_tokens=100,
        )
        try:
            resp = await provider.complete(req)
            s.summary = resp.content.strip()
        except Exception as e:
            logger.warning("Summary failed for section %d: %s", s.index, e)
            s.summary = s.title

        summaries.append(f"[{s.index}] {s.title}: {s.summary}")

    cmap.section_map = "\n".join(summaries)
    cmap._summaries_built = True


def build_focused_context(cmap: CognitiveMap, query: str, max_chars: int = 8000, file_type: str | None = None) -> dict:
    """Build a focused context for a specific question about the document.

    Returns dict with:
    - context: the text to inject into the prompt
    - sections_used: list of section indices used
    - level: which cognitive map level was used
    - token_estimate: approximate token count
    """
    # For tables with profile: use statistical profile instead of raw rows
    if cmap.table_profile:
        # Table Intelligence: schema + stats + sample + anomalies
        context_parts = [cmap.table_profile]

        # If query mentions specific values, try to filter matching rows
        try:
            from app.files.table_intel import _filter_rows_for_query
            raw_text = "\n\n".join(s.text for s in cmap.sections)
            filtered = _filter_rows_for_query(raw_text, query)
            if filtered:
                context_parts.append(f"\n### СТРОКИ ПО ЗАПРОСУ:\n{filtered}")
        except Exception:
            pass

        context = "\n".join(context_parts)
        return {
            "context": context,
            "sections_used": [s.index for s in cmap.sections],
            "level": "table_profile",
            "token_estimate": len(context) // 4,
        }

    # If document is small enough, use full text
    if cmap.total_chars <= max_chars:
        return {
            "context": "\n\n".join(f"### {s.title}\n{s.text}" for s in cmap.sections),
            "sections_used": [s.index for s in cmap.sections],
            "level": "full",
            "token_estimate": cmap.total_chars // 4,
        }

    # Find relevant sections
    relevant_indices = cmap.find_relevant_sections(query, top_k=5)

    # Collect sections up to max_chars
    selected = []
    total = 0
    for idx in relevant_indices:
        s = cmap.sections[idx]
        if total + len(s.text) > max_chars:
            # Truncate last section to fit
            remaining = max_chars - total
            if remaining > 200:
                truncated = s.text[:remaining] + "\n[...секция обрезана...]"
                selected.append((s, truncated))
                total += remaining
            break
        selected.append((s, s.text))
        total += len(s.text)

    # Build context with skeleton + relevant sections
    parts = [f"СТРУКТУРА ДОКУМЕНТА:\n{cmap.skeleton}\n"]
    if cmap.section_map:
        parts.append(f"КАРТА СЕКЦИЙ:\n{cmap.section_map}\n")
    parts.append("РЕЛЕВАНТНЫЕ СЕКЦИИ (полный текст):")
    for s, text in selected:
        parts.append(f"\n### [{s.index}] {s.title}\n{text}")

    context = "\n".join(parts)

    return {
        "context": context,
        "sections_used": [s.index for s, _ in selected],
        "level": "focused",
        "token_estimate": len(context) // 4,
    }


# ── Section Splitters (per file type) ──

def _split_by_headings(text: str) -> list[Section]:
    """Split by markdown-style headings or ALL-CAPS lines."""
    heading_pattern = re.compile(
        r'^(?:#{1,4}\s+.+|[A-ZА-ЯЁ][A-ZА-ЯЁ\s]{5,}|(?:\d+[\.\)]\s+).{5,})$',
        re.MULTILINE
    )

    matches = list(heading_pattern.finditer(text))
    if not matches:
        return []

    sections = []
    for i, m in enumerate(matches):
        title = m.group().strip().lstrip('#').strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if section_text:
            sections.append(Section(
                index=i, title=title[:100], text=section_text,
                start_char=start, end_char=end,
            ))

    return sections


def _split_by_page_markers(text: str) -> list[Section]:
    """Split PDF/PPTX by [Страница N] or [Слайд N] markers."""
    pattern = re.compile(r'^\[(?:Страница|Слайд)\s+(\d+)\]', re.MULTILINE)
    matches = list(pattern.finditer(text))
    if not matches:
        return _split_by_headings(text)

    sections = []
    for i, m in enumerate(matches):
        page_num = m.group(1)
        marker = m.group().strip('[]')
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if section_text:
            # Try to extract a heading from the first line after marker
            first_line = section_text.split('\n', 2)[1].strip() if '\n' in section_text else ""
            title = f"{marker}: {first_line[:60]}" if first_line else marker
            sections.append(Section(
                index=i, title=title, text=section_text,
                start_char=start, end_char=end,
            ))

    return sections


def _split_by_sheet_markers(text: str) -> list[Section]:
    """Split Excel by [Лист: Name] markers."""
    pattern = re.compile(r'^\[Лист:\s*(.+?)\]', re.MULTILINE)
    matches = list(pattern.finditer(text))
    if not matches:
        return [Section(index=0, title="Таблица", text=text, start_char=0, end_char=len(text))]

    sections = []
    for i, m in enumerate(matches):
        sheet_name = m.group(1)
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if section_text:
            sections.append(Section(
                index=i, title=f"Лист: {sheet_name}", text=section_text,
                start_char=start, end_char=end,
            ))

    return sections


def _split_code(text: str) -> list[Section]:
    """Split code by function/class definitions."""
    pattern = re.compile(
        r'^(?:(?:async\s+)?(?:def|function|func|fn|class|struct|interface|impl)\s+\w+)',
        re.MULTILINE
    )
    matches = list(pattern.finditer(text))
    if not matches:
        # Fallback: split by blank lines into logical blocks
        return _split_by_headings(text)

    sections = []
    for i, m in enumerate(matches):
        name = m.group().strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if section_text:
            sections.append(Section(
                index=i, title=name[:80], text=section_text,
                start_char=start, end_char=end,
            ))

    # Add preamble (imports, etc.) if code starts after first function
    if matches and matches[0].start() > 50:
        preamble = text[:matches[0].start()].strip()
        if preamble:
            sections.insert(0, Section(
                index=-1, title="Импорты и конфигурация", text=preamble,
                start_char=0, end_char=matches[0].start(),
            ))
            # Reindex
            for i, s in enumerate(sections):
                s.index = i

    return sections
