from __future__ import annotations

import html
from typing import Any

from .shared import (
    JsonArgumentParser,
    SkillError,
    atomic_write,
    emit,
    finite_number,
    path_result,
    project_path,
    project_root,
    read_json_spec,
    reject_unknown,
    require_reportlab,
    run,
    text_value,
)


MAX_BLOCKS = 1000
MAX_TABLE_ROWS = 500
MAX_TABLE_COLUMNS = 30
FONT_NAME = "STSong-Light"


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Create a PDF from a constrained JSON specification.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--output", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--spec-json")
    group.add_argument("--spec-file")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def escaped(value: str) -> str:
    return html.escape(value, quote=False).replace("\n", "<br/>")


def metadata_value(spec: dict[str, Any], key: str) -> str:
    value = spec.get(key, "")
    return text_value(value, label=key, maximum=1024)


def margins_from(spec: dict[str, Any], mm: float) -> dict[str, float]:
    raw = spec.get("margins_mm", {})
    if not isinstance(raw, dict):
        raise SkillError("invalid_margins", "margins_mm must be an object.")
    reject_unknown(raw, {"top", "right", "bottom", "left"}, label="margins_mm")
    margins: dict[str, float] = {}
    for name, default in (("top", 20.0), ("right", 18.0), ("bottom", 20.0), ("left", 18.0)):
        margins[name] = finite_number(
            raw.get(name, default),
            label=f"margins_mm.{name}",
            minimum=5,
            maximum=60,
        ) * mm
    return margins


def color_from(raw: Any, colors: Any, *, label: str) -> Any:
    if raw is None:
        return colors.HexColor("#8B1E2D")
    if not isinstance(raw, str) or len(raw) != 7 or not raw.startswith("#"):
        raise SkillError("invalid_color", f"{label} must be a #RRGGBB string.")
    try:
        return colors.HexColor(raw)
    except ValueError as exc:
        raise SkillError("invalid_color", f"{label} must be a valid #RRGGBB string.") from exc


def scalar_text(value: Any, *, label: str) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (str, int, float)):
        result = str(value)
        if len(result) > 5000:
            raise SkillError("text_too_long", f"{label} exceeds 5000 characters.")
        return result
    raise SkillError("invalid_table_cell", f"{label} must be a string, number, boolean, or null.")


def table_rows(value: Any, *, label: str) -> list[list[str]]:
    if not isinstance(value, list) or not value:
        raise SkillError("invalid_table", f"{label} must be a non-empty array of row arrays.")
    if len(value) > MAX_TABLE_ROWS:
        raise SkillError("table_too_large", f"{label} exceeds {MAX_TABLE_ROWS} rows.")
    rows: list[list[str]] = []
    width = 0
    for row_index, raw_row in enumerate(value, start=1):
        if not isinstance(raw_row, list) or not raw_row:
            raise SkillError("invalid_table_row", f"{label}[{row_index}] must be a non-empty array.")
        if len(raw_row) > MAX_TABLE_COLUMNS:
            raise SkillError("table_too_wide", f"{label}[{row_index}] exceeds {MAX_TABLE_COLUMNS} columns.")
        row = [scalar_text(cell, label=f"{label}[{row_index}][{index}]") for index, cell in enumerate(raw_row, 1)]
        rows.append(row)
        width = max(width, len(row))
    for row in rows:
        row.extend([""] * (width - len(row)))
    return rows


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    output = project_path(args.output, root, label="--output", suffix=".pdf")
    spec = read_json_spec(inline=args.spec_json, file_path=args.spec_file, root=root)
    reject_unknown(
        spec,
        {"title", "author", "subject", "header", "footer", "page_size", "margins_mm", "accent_color", "blocks"},
        label="PDF specification",
    )
    blocks = spec.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise SkillError("invalid_spec", "The create specification requires a non-empty blocks array.")
    if len(blocks) > MAX_BLOCKS:
        raise SkillError("too_many_blocks", f"blocks exceeds {MAX_BLOCKS} items.")

    rl = require_reportlab()
    page_size_name = spec.get("page_size", "A4")
    if page_size_name not in ("A4", "LETTER"):
        raise SkillError("invalid_page_size", "page_size must be A4 or LETTER.")
    page_size = rl[page_size_name]
    margins = margins_from(spec, rl["mm"])
    title = metadata_value(spec, "title")
    author = metadata_value(spec, "author")
    subject = metadata_value(spec, "subject")
    header = metadata_value(spec, "header")
    footer = metadata_value(spec, "footer")
    if header and margins["top"] < 16 * rl["mm"]:
        raise SkillError("header_margin_too_small", "margins_mm.top must be at least 16 when header is set.")
    if footer and margins["bottom"] < 15 * rl["mm"]:
        raise SkillError("footer_margin_too_small", "margins_mm.bottom must be at least 15 when footer is set.")
    accent = color_from(spec.get("accent_color"), rl["colors"], label="accent_color")

    pdfmetrics = rl["pdfmetrics"]
    try:
        pdfmetrics.getFont(FONT_NAME)
    except KeyError:
        pdfmetrics.registerFont(rl["UnicodeCIDFont"](FONT_NAME))
    pdfmetrics.registerFontFamily(
        FONT_NAME,
        normal=FONT_NAME,
        bold=FONT_NAME,
        italic=FONT_NAME,
        boldItalic=FONT_NAME,
    )

    styles = rl["getSampleStyleSheet"]()
    alignments = {
        "left": rl["TA_LEFT"],
        "center": rl["TA_CENTER"],
        "right": rl["TA_RIGHT"],
    }
    body = rl["ParagraphStyle"](
        "ECNUBody",
        parent=styles["BodyText"],
        fontName=FONT_NAME,
        fontSize=10.5,
        leading=17,
        textColor=rl["colors"].HexColor("#25201F"),
        spaceAfter=7,
    )
    bullet = rl["ParagraphStyle"](
        "ECNUBullet",
        parent=body,
        leftIndent=14,
        firstLineIndent=-8,
        bulletIndent=3,
    )
    heading_styles = {
        1: rl["ParagraphStyle"](
            "ECNUHeading1", parent=body, fontSize=20, leading=28, textColor=accent, spaceBefore=8, spaceAfter=12
        ),
        2: rl["ParagraphStyle"](
            "ECNUHeading2", parent=body, fontSize=15, leading=22, textColor=accent, spaceBefore=7, spaceAfter=8
        ),
        3: rl["ParagraphStyle"](
            "ECNUHeading3", parent=body, fontSize=12, leading=18, textColor=accent, spaceBefore=5, spaceAfter=6
        ),
    }

    story: list[Any] = []
    block_counts: dict[str, int] = {}
    for index, block in enumerate(blocks, start=1):
        if not isinstance(block, dict):
            raise SkillError("invalid_block", f"blocks[{index}] must be an object.")
        kind = block.get("type")
        if not isinstance(kind, str):
            raise SkillError("invalid_block", f"blocks[{index}].type must be a string.")
        if kind == "heading":
            reject_unknown(block, {"type", "level", "text"}, label=f"blocks[{index}]")
            level = block.get("level", 1)
            if isinstance(level, bool) or level not in (1, 2, 3):
                raise SkillError("invalid_heading_level", f"blocks[{index}].level must be 1, 2, or 3.")
            content = text_value(block.get("text"), label=f"blocks[{index}].text", required=True)
            story.append(rl["Paragraph"](escaped(content), heading_styles[level]))
        elif kind == "paragraph":
            reject_unknown(block, {"type", "text", "alignment"}, label=f"blocks[{index}]")
            content = text_value(block.get("text"), label=f"blocks[{index}].text", maximum=50000)
            alignment = block.get("alignment", "left")
            if alignment not in alignments:
                raise SkillError("invalid_alignment", f"blocks[{index}].alignment must be left, center, or right.")
            style = rl["ParagraphStyle"](
                f"ECNUParagraph{index}",
                parent=body,
                alignment=alignments[alignment],
            )
            story.append(rl["Paragraph"](escaped(content), style))
        elif kind == "bullet-list":
            reject_unknown(block, {"type", "items"}, label=f"blocks[{index}]")
            items = block.get("items")
            if not isinstance(items, list) or not items or len(items) > 500:
                raise SkillError("invalid_bullet_list", f"blocks[{index}].items must contain 1 to 500 strings.")
            for item_index, item in enumerate(items, start=1):
                content = text_value(item, label=f"blocks[{index}].items[{item_index}]", required=True)
                story.append(rl["Paragraph"](escaped(content), bullet, bulletText="•"))
        elif kind == "table":
            reject_unknown(block, {"type", "rows", "column_widths_mm", "header"}, label=f"blocks[{index}]")
            rows = table_rows(block.get("rows"), label=f"blocks[{index}].rows")
            paragraph_rows = [
                [rl["Paragraph"](escaped(cell), body) for cell in row]
                for row in rows
            ]
            widths = block.get("column_widths_mm")
            column_widths = None
            if widths is not None:
                if not isinstance(widths, list) or len(widths) != len(rows[0]):
                    raise SkillError(
                        "invalid_column_widths",
                        f"blocks[{index}].column_widths_mm must match the table column count.",
                    )
                column_widths = [
                    finite_number(value, label=f"blocks[{index}].column_widths_mm[{width_index}]", minimum=5, maximum=250)
                    * rl["mm"]
                    for width_index, value in enumerate(widths, start=1)
                ]
                available_width = page_size[0] - margins["left"] - margins["right"]
                if sum(column_widths) > available_width + 0.01:
                    raise SkillError("table_too_wide", f"blocks[{index}] column widths exceed the printable page width.")
            table = rl["Table"](paragraph_rows, colWidths=column_widths, repeatRows=1 if block.get("header", False) else 0)
            commands: list[tuple[Any, ...]] = [
                ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.5, rl["colors"].HexColor("#C9C1BC")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
            header_value = block.get("header", False)
            if not isinstance(header_value, bool):
                raise SkillError("invalid_header", f"blocks[{index}].header must be boolean.")
            if header_value:
                commands.extend(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), rl["colors"].HexColor("#F3E8E9")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), accent),
                    ]
                )
            table.setStyle(rl["TableStyle"](commands))
            story.extend([table, rl["Spacer"](1, 8)])
        elif kind == "page-break":
            reject_unknown(block, {"type"}, label=f"blocks[{index}]")
            story.append(rl["PageBreak"]())
        else:
            raise SkillError(
                "unsupported_block",
                f"blocks[{index}].type is not supported.",
                details={"type": kind, "supported": ["heading", "paragraph", "bullet-list", "table", "page-break"]},
            )
        block_counts[kind] = block_counts.get(kind, 0) + 1

    def write_pdf(temporary: Any) -> None:
        document = rl["SimpleDocTemplate"](
            str(temporary),
            pagesize=page_size,
            rightMargin=margins["right"],
            leftMargin=margins["left"],
            topMargin=margins["top"],
            bottomMargin=margins["bottom"],
            title=title,
            author=author,
            subject=subject,
        )

        def draw_page(canvas: Any, doc: Any) -> None:
            canvas.saveState()
            canvas.setTitle(title)
            canvas.setAuthor(author)
            canvas.setSubject(subject)
            canvas.setFont(FONT_NAME, 8.5)
            canvas.setFillColor(rl["colors"].HexColor("#6E6561"))
            if header:
                canvas.drawString(margins["left"], page_size[1] - 11 * rl["mm"], header)
            if footer:
                rendered = footer.replace("{page}", str(doc.page))
                canvas.drawCentredString(page_size[0] / 2, 9 * rl["mm"], rendered)
            canvas.restoreState()

        document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)

    atomic_write(output, write_pdf, overwrite=args.overwrite)
    emit(
        {
            "ok": True,
            "operation": "create",
            **path_result(output, root),
            "page_size": page_size_name,
            "block_count": len(blocks),
            "block_counts": block_counts,
            "font": FONT_NAME,
            "visual_validation": False,
        }
    )
    return 0


if __name__ == "__main__":
    run("create", main)
