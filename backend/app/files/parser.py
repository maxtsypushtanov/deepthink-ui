"""Stage 1 — Parse: extract text from uploaded files."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".txt", ".md", ".py", ".js", ".ts", ".tsx", ".jsx", ".json",
                        ".yaml", ".yml", ".toml", ".csv", ".html", ".css", ".sql",
                        ".sh", ".bash", ".rs", ".go", ".java", ".c", ".cpp", ".h",
                        ".rb", ".php", ".swift", ".kt", ".xml", ".ini", ".cfg",
                        ".pdf", ".docx", ".pptx", ".xlsx", ".xls",
                        ".png", ".jpg", ".jpeg", ".gif", ".webp"}

# Code-like extensions for syntax hint
CODE_EXTENSIONS = {".py", ".js", ".ts", ".tsx", ".jsx", ".rs", ".go", ".java",
                   ".c", ".cpp", ".h", ".rb", ".php", ".swift", ".kt", ".sql",
                   ".sh", ".bash", ".css", ".html"}


def parse_file(path: str | Path) -> dict:
    """Extract text and metadata from a file.

    Returns:
        {
            "text": str,
            "filename": str,
            "extension": str,
            "char_count": int,
            "file_type": "text" | "code" | "pdf" | "docx",
            "error": str | None,
        }
    """
    p = Path(path)
    ext = p.suffix.lower()
    filename = p.name
    result = {
        "filename": filename,
        "extension": ext,
        "text": "",
        "char_count": 0,
        "file_type": "text",
        "error": None,
    }

    if ext not in SUPPORTED_EXTENSIONS:
        result["error"] = f"Неподдерживаемый формат: {ext}"
        return result

    try:
        if ext == ".pdf":
            result["text"] = _parse_pdf(p)
            result["file_type"] = "pdf"
        elif ext == ".docx":
            result["text"] = _parse_docx(p)
            result["file_type"] = "docx"
        elif ext == ".pptx":
            result["text"] = _parse_pptx(p)
            result["file_type"] = "pptx"
        elif ext in (".xlsx", ".xls"):
            result["text"] = _parse_xlsx(p)
            result["file_type"] = "xlsx"
        elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            result["file_type"] = "image"
            result["image_base64"] = _image_to_base64(p)
            result["image_mime"] = f"image/{'jpeg' if ext in ('.jpg', '.jpeg') else ext.lstrip('.')}"
            result["text"] = f"[Изображение: {p.name}]"
        elif ext in CODE_EXTENSIONS:
            result["text"] = p.read_text(encoding="utf-8", errors="replace")
            result["file_type"] = "code"
        else:
            result["text"] = p.read_text(encoding="utf-8", errors="replace")
            result["file_type"] = "text"
    except Exception as e:
        logger.warning("Failed to parse %s: %s", filename, e)
        result["error"] = str(e)

    result["char_count"] = len(result["text"])
    return result


def _parse_pdf(path: Path) -> str:
    """Extract text from PDF using pypdf."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    total_pages = len(reader.pages)
    pages = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append(f"[Страница {i + 1}]\n{text}")

    if not pages:
        # No text extracted — likely scanned/image PDF
        raise ValueError(
            f"PDF содержит {total_pages} стр., но текст не извлекается. "
            "Возможно, это сканированный документ без текстового слоя."
        )

    return "\n\n".join(pages)


def _parse_pptx(path: Path) -> str:
    """Extract text from PowerPoint PPTX."""
    from pptx import Presentation

    prs = Presentation(str(path))
    slides = []
    for i, slide in enumerate(prs.slides):
        texts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        texts.append(text)
        if texts:
            slides.append(f"[Слайд {i + 1}]\n" + "\n".join(texts))

    if not slides:
        raise ValueError(
            f"Презентация содержит {len(prs.slides)} слайдов, но текст не найден."
        )
    return "\n\n".join(slides)


def _parse_xlsx(path: Path) -> str:
    """Extract data from Excel XLSX/XLS as text tables."""
    from openpyxl import load_workbook

    wb = load_workbook(str(path), read_only=True, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(c.strip() for c in cells):
                rows.append(" | ".join(cells))
        if rows:
            header = f"[Лист: {ws.title}]"
            sheets.append(header + "\n" + "\n".join(rows))
    wb.close()

    if not sheets:
        raise ValueError("Excel-файл пуст или не содержит данных.")
    return "\n\n".join(sheets)


def _parse_image(path: Path) -> str:
    """Return a placeholder description for images (actual analysis done by vision LLM)."""
    size_kb = path.stat().st_size / 1024
    return f"[Изображение: {path.name}, {size_kb:.0f} КБ]"


def _image_to_base64(path: Path) -> str:
    """Encode image file as base64 string."""
    import base64
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _parse_docx(path: Path) -> str:
    """Extract text from DOCX using python-docx."""
    from docx import Document

    doc = Document(str(path))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)
