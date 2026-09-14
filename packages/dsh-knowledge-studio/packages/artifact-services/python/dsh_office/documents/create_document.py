from __future__ import annotations

from typing import Any

from .shared import (
    JsonArgumentParser,
    SkillError,
    add_blocks,
    apply_properties,
    atomic_save,
    emit,
    finite_number,
    non_empty_text,
    path_result,
    project_path,
    project_root,
    read_json_spec,
    reject_unknown,
    require_docx,
    run,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Create a DOCX document from a JSON specification.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--output", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--spec-json")
    group.add_argument("--spec-file")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def configure_defaults(document: Any, spec: Any, docx: Any) -> dict[str, Any]:
    if spec is None:
        spec = {}
    if not isinstance(spec, dict):
        raise SkillError("invalid_defaults", "defaults must be an object.")
    reject_unknown(spec, {"font", "east_asia_font", "font_size_pt"}, label="defaults")
    font = non_empty_text(spec.get("font", "Aptos"), label="defaults.font", maximum=100)
    east_asia = non_empty_text(spec.get("east_asia_font", "微软雅黑"), label="defaults.east_asia_font", maximum=100)
    size = finite_number(spec.get("font_size_pt", 11), label="defaults.font_size_pt", minimum=6, maximum=72)
    styles = [document.styles["Normal"]]
    for style_name in ("Title", "Heading 1", "Heading 2", "Heading 3"):
        try:
            styles.append(document.styles[style_name])
        except KeyError:
            pass
    for style in styles:
        style.font.name = font
        style._element.get_or_add_rPr().rFonts.set(docx.oxml.ns.qn("w:eastAsia"), east_asia)
    document.styles["Normal"].font.size = docx.shared.Pt(size)
    return {"font": font, "east_asia_font": east_asia, "font_size_pt": size}


def configure_page(document: Any, spec: Any, docx: Any) -> dict[str, Any]:
    if spec is None:
        spec = {}
    if not isinstance(spec, dict):
        raise SkillError("invalid_page", "page must be an object.")
    reject_unknown(spec, {"orientation", "margins_cm"}, label="page")
    orientation = spec.get("orientation", "portrait")
    if orientation not in {"portrait", "landscape"}:
        raise SkillError("invalid_orientation", "page.orientation must be portrait or landscape.")
    margins = spec.get("margins_cm", {})
    if not isinstance(margins, dict):
        raise SkillError("invalid_margins", "page.margins_cm must be an object.")
    allowed = {"top", "right", "bottom", "left"}
    if set(margins) - allowed:
        raise SkillError("invalid_margins", "page.margins_cm contains unsupported keys.")
    applied = {name: finite_number(margins.get(name, 2.54), label=f"page.margins_cm.{name}", minimum=0.5, maximum=10) for name in allowed}
    for section in document.sections:
        section.orientation = (
            docx.enum.section.WD_ORIENT.LANDSCAPE
            if orientation == "landscape"
            else docx.enum.section.WD_ORIENT.PORTRAIT
        )
        if orientation == "landscape":
            section.page_width, section.page_height = section.page_height, section.page_width
        section.top_margin = docx.shared.Cm(applied["top"])
        section.right_margin = docx.shared.Cm(applied["right"])
        section.bottom_margin = docx.shared.Cm(applied["bottom"])
        section.left_margin = docx.shared.Cm(applied["left"])
    return {"orientation": orientation, "margins_cm": applied}


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    output = project_path(args.output, root, label="--output", suffix=".docx")
    spec = read_json_spec(inline=args.spec_json, file_path=args.spec_file, root=root)
    reject_unknown(spec, {"properties", "defaults", "page", "blocks", "page_numbers"}, label="document specification")
    blocks = spec.get("blocks")
    docx = require_docx()
    document = docx.Document()
    if "properties" in spec:
        apply_properties(document, spec["properties"])
    defaults = configure_defaults(document, spec.get("defaults"), docx)
    page = configure_page(document, spec.get("page"), docx)
    counts = add_blocks(document, blocks, root=root, docx=docx)
    if spec.get("page_numbers", False):
        for section in document.sections:
            paragraph = section.footer.paragraphs[0]
            paragraph.alignment = docx.enum.text.WD_ALIGN_PARAGRAPH.CENTER
            field = docx.oxml.OxmlElement("w:fldSimple")
            field.set(docx.oxml.ns.qn("w:instr"), "PAGE")
            paragraph._p.append(field)
    atomic_save(document, output, overwrite=args.overwrite)
    emit(
        {
            "ok": True,
            "operation": "create",
            **path_result(output, root),
            "blocks_written": sum(counts.values()),
            "block_counts": counts,
            "defaults": defaults,
            "page": page,
        }
    )
    return 0


if __name__ == "__main__":
    run("create", main)
