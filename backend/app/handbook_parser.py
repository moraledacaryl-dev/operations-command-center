"""Layout-aware PDF handbook extraction into private, structured guide content.

No handbook text is bundled with the public repository or static frontend.
Uploads become owner-reviewed *drafts*, never automatically published.
"""
from __future__ import annotations

from hashlib import sha256
import re

import fitz

SCHEMA = "hidden-oasis-handbook/v1"
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 160
MAX_CHARS = 250_000

SECTION_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){1,2})\s+(.+)$")
CHAPTER_RE = re.compile(r"^SECTION\s+(\d{1,2})$", re.IGNORECASE)


def _clean(value: str) -> str:
    return " ".join(value.replace("\u00ad", "").split())


def _join(prev: str, next_text: str) -> str:
    if prev.endswith("-") and next_text and next_text[0].islower():
        return prev + next_text
    return prev + " " + next_text


def _lines(page):
    raw = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            if not line["spans"]:
                continue
            content = _clean("".join(span["text"] for span in line["spans"]))
            if not content:
                continue
            x, y = line["bbox"][:2]
            if y < 108 or y > 738:  # page headers and footers are not policy text
                continue
            raw.append({
                "text": content, "x": x, "y": y,
                "font": max(span["size"] for span in line["spans"]),
            })
    raw.sort(key=lambda row: (round(row["y"] / 2), row["x"]))
    merged = []
    for row in raw:
        if merged and abs(merged[-1]["y"] - row["y"]) < 3.3 and row["x"] > merged[-1]["x"] + 2:
            merged[-1]["text"] += " " + row["text"]
            merged[-1]["font"] = max(merged[-1]["font"], row["font"])
        else:
            merged.append(row.copy())

    # The uploaded handbook draws its bullet dots as vector paths.
    # Text-only extraction drops them; restore list starts geometrically.
    bullet_dots = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        fill = drawing.get("fill")
        if (drawing["type"] == "f" and fill and max(fill) < 0.3
                and 2.1 <= rect.width <= 5 and 2.1 <= rect.height <= 5):
            bullet_dots.append((rect.x0, rect.y0))
    for row in merged:
        row["bullet"] = any(
            0 < row["x"] - x < 55 and 0 < y - row["y"] < 11
            for x, y in bullet_dots
        )
    return merged


def parse_handbook_pdf(raw: bytes) -> dict:
    """Returns chapters, numbered sections, paragraphs, and restored bullet lists.

    The original PDF remains the source of truth. This parser does not rewrite
    or validate company policy, and is intentionally strict about recognisable
    document structure instead of silently accepting corrupted extraction.
    """
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("Choose a PDF smaller than 10 MB.")
    if not raw.startswith(b"%PDF-"):
        raise ValueError("This file is not a PDF.")
    try:
        document = fitz.open(stream=raw, filetype="pdf")
    except Exception as exc:
        raise ValueError("This PDF could not be opened.") from exc
    if document.is_encrypted:
        raise ValueError("Remove the PDF password before importing.")
    if document.page_count > MAX_PAGES:
        raise ValueError("This handbook has too many pages for one import.")

    chapters = []
    chapter = None
    section = None
    paragraph = ""
    bullets = None
    previous = None
    title_parts = []
    total_chars = 0

    def flush():
        nonlocal paragraph, bullets
        if section is not None:
            if paragraph:
                section["blocks"].append({"type": "paragraph", "text": paragraph})
            if bullets is not None:
                section["blocks"].append(bullets)
        paragraph = ""
        bullets = None

    def ensure_section(page_number: int):
        nonlocal section
        if section is None and chapter is not None:
            section = {
                "id": f"section-{chapter['number']}-intro",
                "number": "", "title": "Introduction",
                "page": page_number, "blocks": [],
            }
            chapter["sections"].append(section)

    for index in range(document.page_count):
        page_number = index + 1
        for line in _lines(document[index]):
            value, y, font = line["text"], line["y"], line["font"]
            total_chars += len(value)
            if total_chars > MAX_CHARS:
                raise ValueError("The PDF contains too much text for one handbook.")
            chapter_match = CHAPTER_RE.fullmatch(value) if font >= 14.5 else None
            if chapter_match:
                flush()
                number = chapter_match.group(1)
                chapter = {
                    "id": "section-" + number, "number": number,
                    "title": "Section " + number, "page": page_number,
                    "sections": [],
                }
                chapters.append(chapter)
                section, previous, title_parts = None, None, []
                continue

            if value == "ACKNOWLEDGMENT OF RECEIPT AND AGREEMENT" and font >= 13:
                flush()
                chapter = {
                    "id": "acknowledgment", "number": "ack",
                    "title": "Acknowledgment of Receipt and Agreement",
                    "page": page_number, "sections": [],
                }
                chapters.append(chapter)
                section, previous, title_parts = None, None, []
                continue

            if chapter is None:
                continue  # cover and printed table of contents

            if font >= 14 and value.isupper() and y < 200 and chapter["number"] != "ack":
                title_parts.append(value)
                continue

            match = SECTION_RE.match(value) if font >= 11.8 else None
            if match and match.group(1).split(".")[0] == chapter["number"]:
                flush()
                if title_parts:
                    chapter["title"] = " ".join(title_parts).title()
                    title_parts = []
                number, title = match.groups()
                section = {
                    "id": "section-" + number.replace(".", "-"), "number": number,
                    "title": title, "page": page_number, "blocks": [],
                }
                chapter["sections"].append(section)
                previous = None
                continue

            if chapter["number"] == "ack" and font >= 11.8 and value.isupper():
                flush()
                section = {
                    "id": "ack-" + re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-"),
                    "number": "", "title": value.title(),
                    "page": page_number, "blocks": [],
                }
                chapter["sections"].append(section)
                previous = None
                continue

            ensure_section(page_number)
            if section is None:
                continue
            if line["bullet"]:
                if paragraph:
                    section["blocks"].append({"type": "paragraph", "text": paragraph})
                    paragraph = ""
                if bullets is None:
                    bullets = {"type": "bullets", "items": []}
                bullets["items"].append({"text": value})
            elif bullets is not None:
                if previous and y - previous["y"] <= 18 and line["x"] >= previous["x"] - 3:
                    item = bullets["items"][-1]
                    item["text"] = _join(item["text"], value)
                else:
                    section["blocks"].append(bullets)
                    bullets = None
                    paragraph = value
            elif paragraph:
                if previous and y - previous["y"] <= 18.7 and abs(line["x"] - previous["x"]) <= 55:
                    paragraph = _join(paragraph, value)
                else:
                    section["blocks"].append({"type": "paragraph", "text": paragraph})
                    paragraph = value
            else:
                paragraph = value
            previous = line
        flush()

    if len(chapters) < 1 or sum(len(ch["sections"]) for ch in chapters) < 4:
        raise ValueError(
            "Could not identify the handbook chapters. Please upload a text-based PDF."
        )
    if any(not ch["sections"] for ch in chapters):
        raise ValueError("The PDF has an incomplete chapter. Please review the source.")
    text_chars = sum(
        len(block.get("text", "")) + sum(len(item["text"]) for item in block.get("items", []))
        for chapter in chapters for sec in chapter["sections"] for block in sec["blocks"]
    )
    if text_chars < 100:
        raise ValueError("Too little readable handbook text was found.")
    return {
        "schema": SCHEMA,
        "title": "Hidden Oasis Resort & Restaurant Staff Handbook",
        "edition": "2026",
        "source_pages": document.page_count,
        "source_sha256": sha256(raw).hexdigest(),
        "chapters": chapters,
    }
