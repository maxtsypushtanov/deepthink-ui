"""Table Intelligence — statistical profiling for large tables.

TRIZ #26 "Copying": replace raw data with a compact statistical profile.
A 100K-row table becomes ~500 tokens that the LLM can reason about effectively.

TRIZ #3 "Local Quality": each column gets treatment matching its type —
numeric → stats, text → categories, dates → range.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ColumnProfile:
    """Statistical profile of a single column."""
    name: str
    dtype: str  # "numeric", "text", "date", "boolean", "empty"
    total: int = 0
    nulls: int = 0
    unique: int = 0
    # Numeric stats
    min_val: float | None = None
    max_val: float | None = None
    mean_val: float | None = None
    median_val: float | None = None
    # Text stats
    top_values: list[tuple[str, int]] = field(default_factory=list)
    avg_length: float = 0
    # Date stats
    date_range: tuple[str, str] | None = None


@dataclass
class TableProfile:
    """Complete statistical profile of a table."""
    sheet_name: str
    rows: int
    columns: list[ColumnProfile]
    sample_head: list[list[str]] = field(default_factory=list)  # First 5 rows
    sample_tail: list[list[str]] = field(default_factory=list)  # Last 3 rows
    anomalies: list[str] = field(default_factory=list)

    def to_prompt(self) -> str:
        """Render as compact text for LLM prompt (~300-500 tokens per sheet)."""
        parts = [f"### Лист: {self.sheet_name} ({self.rows:,} строк, {len(self.columns)} столбцов)\n"]

        # Schema + stats
        parts.append("СХЕМА И СТАТИСТИКА:")
        for col in self.columns:
            line = f"  {col.name} [{col.dtype}]"
            if col.nulls > 0:
                null_pct = col.nulls / max(col.total, 1) * 100
                line += f" — {null_pct:.0f}% пустых"
            if col.dtype == "numeric" and col.min_val is not None:
                line += f" — мин: {_fmt_num(col.min_val)}, макс: {_fmt_num(col.max_val)}, сред: {_fmt_num(col.mean_val)}"
            elif col.dtype == "text" and col.top_values:
                top3 = ", ".join(f'"{v}" ({c})' for v, c in col.top_values[:3])
                line += f" — {col.unique} уник. | топ: {top3}"
            elif col.dtype == "date" and col.date_range:
                line += f" — от {col.date_range[0]} до {col.date_range[1]}"
            parts.append(line)

        # Sample rows
        if self.sample_head:
            parts.append(f"\nПЕРВЫЕ {len(self.sample_head)} СТРОК:")
            header = " | ".join(c.name for c in self.columns)
            parts.append(f"  {header}")
            parts.append(f"  {'—' * min(len(header), 60)}")
            for row in self.sample_head:
                parts.append(f"  {' | '.join(str(v)[:30] for v in row)}")

        if self.sample_tail:
            parts.append(f"\nПОСЛЕДНИЕ {len(self.sample_tail)} СТРОК:")
            for row in self.sample_tail:
                parts.append(f"  {' | '.join(str(v)[:30] for v in row)}")

        # Anomalies
        if self.anomalies:
            parts.append(f"\nАНОМАЛИИ ({len(self.anomalies)}):")
            for a in self.anomalies[:5]:
                parts.append(f"  - {a}")

        return "\n".join(parts)


def _fmt_num(v: float | None) -> str:
    if v is None:
        return "?"
    if abs(v) >= 1_000_000:
        return f"{v / 1_000_000:.1f}M"
    if abs(v) >= 1_000:
        return f"{v / 1_000:.1f}K"
    if isinstance(v, float) and v != int(v):
        return f"{v:.2f}"
    return str(int(v))


# ── Profiling ──

def profile_table_from_text(text: str, sheet_name: str = "Sheet1") -> TableProfile:
    """Build a statistical profile from pipe-separated text (our Excel/CSV format)."""
    lines = [l for l in text.strip().split('\n') if l.strip()]
    if not lines:
        return TableProfile(sheet_name=sheet_name, rows=0, columns=[])

    # Parse header
    sep = '|' if '|' in lines[0] else ','
    headers = [h.strip().strip('"') for h in lines[0].split(sep)]
    data_lines = lines[1:]

    # Parse all rows
    rows_data: list[list[str]] = []
    for line in data_lines:
        cells = [c.strip().strip('"') for c in line.split(sep)]
        # Pad or truncate to match header count
        while len(cells) < len(headers):
            cells.append("")
        rows_data.append(cells[:len(headers)])

    n_rows = len(rows_data)

    # Profile each column
    columns: list[ColumnProfile] = []
    for col_idx, name in enumerate(headers):
        values = [row[col_idx] if col_idx < len(row) else "" for row in rows_data]
        profile = _profile_column(name, values)
        columns.append(profile)

    # Sample rows
    sample_head = rows_data[:5]
    sample_tail = rows_data[-3:] if n_rows > 8 else []

    # Detect anomalies
    anomalies = _detect_anomalies(columns, n_rows)

    return TableProfile(
        sheet_name=sheet_name,
        rows=n_rows,
        columns=columns,
        sample_head=sample_head,
        sample_tail=sample_tail,
        anomalies=anomalies,
    )


def _profile_column(name: str, values: list[str]) -> ColumnProfile:
    """Infer type and compute stats for a column."""
    total = len(values)
    non_empty = [v for v in values if v.strip()]
    nulls = total - len(non_empty)
    unique = len(set(non_empty))

    if not non_empty:
        return ColumnProfile(name=name, dtype="empty", total=total, nulls=nulls, unique=0)

    # Try numeric
    numeric_vals = []
    for v in non_empty:
        cleaned = v.replace(',', '.').replace(' ', '').replace('\xa0', '')
        try:
            numeric_vals.append(float(cleaned))
        except ValueError:
            break
    else:
        # All non-empty values are numeric
        if numeric_vals:
            sorted_vals = sorted(numeric_vals)
            return ColumnProfile(
                name=name, dtype="numeric", total=total, nulls=nulls,
                unique=unique,
                min_val=sorted_vals[0],
                max_val=sorted_vals[-1],
                mean_val=sum(numeric_vals) / len(numeric_vals),
                median_val=sorted_vals[len(sorted_vals) // 2],
            )

    # Try date
    date_pattern = re.compile(r'^\d{4}[-/]\d{2}[-/]\d{2}|^\d{2}[./]\d{2}[./]\d{4}')
    date_matches = sum(1 for v in non_empty[:20] if date_pattern.match(v))
    if date_matches > len(non_empty[:20]) * 0.7:
        dates_sorted = sorted(non_empty)
        return ColumnProfile(
            name=name, dtype="date", total=total, nulls=nulls, unique=unique,
            date_range=(dates_sorted[0], dates_sorted[-1]),
        )

    # Try boolean
    bool_vals = {v.lower() for v in non_empty}
    if bool_vals <= {"true", "false", "да", "нет", "yes", "no", "0", "1"}:
        counter = Counter(v.lower() for v in non_empty)
        return ColumnProfile(
            name=name, dtype="boolean", total=total, nulls=nulls, unique=unique,
            top_values=counter.most_common(5),
        )

    # Default: text
    counter = Counter(non_empty)
    avg_len = sum(len(v) for v in non_empty) / len(non_empty)
    return ColumnProfile(
        name=name, dtype="text", total=total, nulls=nulls, unique=unique,
        top_values=counter.most_common(5),
        avg_length=avg_len,
    )


def _detect_anomalies(columns: list[ColumnProfile], n_rows: int) -> list[str]:
    """Detect data quality issues."""
    anomalies = []

    for col in columns:
        null_pct = col.nulls / max(col.total, 1)
        if null_pct > 0.5:
            anomalies.append(f"Столбец «{col.name}»: {null_pct*100:.0f}% пустых значений")
        if col.dtype == "text" and col.unique == 1 and col.total > 10:
            anomalies.append(f"Столбец «{col.name}»: всего 1 уникальное значение на {col.total} строк")
        if col.dtype == "numeric" and col.min_val is not None and col.max_val is not None:
            if col.max_val > col.mean_val * 100 and col.mean_val and col.mean_val > 0:
                anomalies.append(f"Столбец «{col.name}»: возможные выбросы (макс {_fmt_num(col.max_val)} при среднем {_fmt_num(col.mean_val)})")

    if n_rows < 2:
        anomalies.append("Таблица содержит менее 2 строк данных")

    return anomalies


# ── Multi-sheet profiling ──

def profile_excel_text(text: str) -> list[TableProfile]:
    """Profile all sheets from our Excel text format (uses [Лист: X] markers)."""
    sheet_pattern = re.compile(r'^\[Лист:\s*(.+?)\]', re.MULTILINE)
    matches = list(sheet_pattern.finditer(text))

    if not matches:
        # No sheet markers — treat as single table
        return [profile_table_from_text(text)]

    profiles = []
    for i, m in enumerate(matches):
        sheet_name = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sheet_text = text[start:end].strip()
        if sheet_text:
            profiles.append(profile_table_from_text(sheet_text, sheet_name))

    return profiles


def build_table_context(text: str, query: str, file_type: str) -> str:
    """Build an intelligent table context for LLM.

    Instead of raw rows, provides:
    1. Schema + stats per column
    2. Sample rows (head + tail)
    3. Anomaly detection
    4. Query-relevant data filtering (if applicable)
    """
    if file_type in ("xlsx", "xls"):
        profiles = profile_excel_text(text)
    else:
        # CSV or pipe-separated
        profiles = [profile_table_from_text(text)]

    # Render all profiles
    parts = []
    for p in profiles:
        parts.append(p.to_prompt())

    full_profile = "\n\n".join(parts)

    # If query mentions specific values/filters, try to extract matching rows
    filtered = _filter_rows_for_query(text, query)
    if filtered:
        full_profile += f"\n\n### СТРОКИ, ПОДХОДЯЩИЕ ПОД ЗАПРОС:\n{filtered}"

    return full_profile


def _filter_rows_for_query(text: str, query: str) -> str:
    """Try to extract rows matching query criteria. Simple keyword filter."""
    # Extract potential filter values from query
    query_lower = query.lower()

    # Find numbers in query that might be thresholds
    numbers = re.findall(r'\d+(?:[.,]\d+)?', query)

    # Find quoted strings in query
    quoted = re.findall(r'[«"\'](.*?)[»"\']', query)

    if not numbers and not quoted:
        return ""

    lines = text.strip().split('\n')
    if len(lines) < 2:
        return ""

    header = lines[0]
    matches = []
    for line in lines[1:]:
        line_lower = line.lower()
        # Check if any query number appears in the row
        for num in numbers:
            if num in line:
                matches.append(line)
                break
        else:
            # Check if any quoted string appears
            for q in quoted:
                if q.lower() in line_lower:
                    matches.append(line)
                    break

    if not matches:
        return ""

    result_lines = [header] + matches[:20]  # Limit to 20 matching rows
    if len(matches) > 20:
        result_lines.append(f"[...ещё {len(matches) - 20} совпадений]")

    return "\n".join(result_lines)
