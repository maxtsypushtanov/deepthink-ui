"""Export conversation messages as PDF."""

from __future__ import annotations

import io
import os
import platform
import re
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

_FONT_LOADED = False


def _find_font() -> str | None:
    """Find a Unicode-capable TTF font for the current platform."""
    candidates: list[str] = []
    system = platform.system()

    if system == "Darwin":
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    elif system == "Linux":
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        ]
    elif system == "Windows":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        candidates = [
            os.path.join(windir, "Fonts", "arial.ttf"),
            os.path.join(windir, "Fonts", "segoeui.ttf"),
        ]

    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _find_bold_font() -> str | None:
    """Find a bold TTF font for the current platform."""
    candidates: list[str] = []
    system = platform.system()

    if system == "Darwin":
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        ]
    elif system == "Linux":
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        ]
    elif system == "Windows":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        candidates = [
            os.path.join(windir, "Fonts", "arialbd.ttf"),
            os.path.join(windir, "Fonts", "segoeuib.ttf"),
        ]

    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _make_pdf(markdown_text: str, title: str = "DeepThink Export") -> bytes:
    """Convert markdown text to a PDF with Cyrillic support."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Load Unicode font
    global _FONT_LOADED
    font_path = _find_font()
    bold_font_path = _find_bold_font()
    try:
        if font_path:
            pdf.add_font("ArialUni", "", font_path, uni=True)
            pdf.add_font("ArialUni", "B", bold_font_path or font_path, uni=True)
            _FONT_LOADED = True
        else:
            logger.warning("No Unicode TTF font found for platform %s", platform.system())
    except Exception:
        logger.warning("Could not load Unicode font, falling back to Helvetica")

    font_name = "ArialUni" if _FONT_LOADED else "Helvetica"

    # Title
    pdf.set_font(font_name, "B", 18)
    pdf.cell(0, 12, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Parse markdown into simple blocks
    lines = markdown_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Headings
        if line.startswith("### "):
            pdf.set_font(font_name, "B", 13)
            pdf.ln(3)
            pdf.multi_cell(0, 7, _strip_md(line[4:]))
            pdf.ln(2)
            pdf.set_font(font_name, "", 11)
            i += 1
            continue
        if line.startswith("## "):
            pdf.set_font(font_name, "B", 14)
            pdf.ln(4)
            pdf.multi_cell(0, 7, _strip_md(line[3:]))
            pdf.ln(2)
            pdf.set_font(font_name, "", 11)
            i += 1
            continue
        if line.startswith("# "):
            pdf.set_font(font_name, "B", 16)
            pdf.ln(5)
            pdf.multi_cell(0, 8, _strip_md(line[2:]))
            pdf.ln(3)
            pdf.set_font(font_name, "", 11)
            i += 1
            continue

        # Code blocks
        if line.startswith("```"):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            pdf.set_font("Courier", "", 9)
            pdf.set_fill_color(240, 240, 240)
            for cl in code_lines:
                pdf.multi_cell(0, 5, cl, fill=True)
            pdf.ln(2)
            pdf.set_font(font_name, "", 11)
            continue

        # Horizontal rule
        if line.strip() in ("---", "***", "___"):
            pdf.ln(3)
            y = pdf.get_y()
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(3)
            i += 1
            continue

        # Bullet lists
        if re.match(r"^[\-\*]\s", line):
            pdf.set_font(font_name, "", 11)
            text = _strip_md(line[2:])
            pdf.cell(6, 6, "\u2022")
            pdf.multi_cell(0, 6, text)
            i += 1
            continue

        # Numbered lists
        m = re.match(r"^(\d+)\.\s", line)
        if m:
            pdf.set_font(font_name, "", 11)
            text = _strip_md(line[m.end():])
            pdf.cell(8, 6, f"{m.group(1)}.")
            pdf.multi_cell(0, 6, text)
            i += 1
            continue

        # Empty line
        if not line.strip():
            pdf.ln(3)
            i += 1
            continue

        # Regular paragraph
        pdf.set_font(font_name, "", 11)
        pdf.multi_cell(0, 6, _strip_md(line))
        i += 1

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return buf.read()


def _strip_md(text: str) -> str:
    """Remove basic markdown formatting (bold, italic, links, inline code)."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)  # bold
    text = re.sub(r"\*(.+?)\*", r"\1", text)  # italic
    text = re.sub(r"`(.+?)`", r"\1", text)  # inline code
    text = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", text)  # links
    return text


class ExportRequest(BaseModel):
    markdown: str
    filename: str = "export.pdf"
    title: str = "DeepThink Export"


@router.post("/api/export/pdf")
async def export_pdf(req: ExportRequest):
    """Generate PDF from markdown text and return as downloadable file."""
    try:
        pdf_bytes = _make_pdf(req.markdown, req.title)
    except Exception as e:
        logger.exception("PDF generation failed")
        raise HTTPException(status_code=500, detail=f"Ошибка генерации PDF: {e}")

    filename = req.filename if req.filename.endswith(".pdf") else f"{req.filename}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
