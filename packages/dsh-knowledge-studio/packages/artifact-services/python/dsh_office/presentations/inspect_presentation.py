from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .shared import (
    EXIT_PRESENTATION,
    JsonArgumentParser,
    PRESENTATION_MARKER,
    SkillError,
    emit,
    has_presentation_marker,
    path_result,
    project_path,
    project_root,
    require_pptx,
    run,
    profile_from_keywords,
    theme_from_keywords,
    validate_ooxml_archive,
)


LAYOUT_PATTERN = re.compile(r"\[([a-z-]+)\](?:$|\s)")
EMU_PER_INCH = 914400


def bounded_integer(value: str, *, minimum: int, maximum: int, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise SkillError("invalid_arguments", f"{label} must be an integer.") from exc
    if not minimum <= parsed <= maximum:
        raise SkillError("invalid_arguments", f"{label} must be between {minimum} and {maximum}.")
    return parsed


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Inspect PPTX slide structure, text, and images.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--max-text-characters", default="400")
    return parser.parse_args()


def normalized_text(value: str, maximum: int) -> tuple[str, bool]:
    text = "\n".join(line.rstrip() for line in value.replace("\r", "").split("\n")).strip()
    if len(text) <= maximum:
        return text, False
    return text[:maximum] + "…", True


def infer_layout(shapes: Any) -> str:
    for shape in shapes:
        match = LAYOUT_PATTERN.search(shape.name or "")
        if match:
            return match.group(1)
    return "unknown"


def infer_profile_marker(shapes: Any) -> str:
    prefix = "ECNU Profile Marker {"
    for shape in shapes:
        name = shape.name or ""
        if name.startswith(prefix) and name.endswith("}"):
            return name[len(prefix) : -1]
    return ""


def infer_theme_marker(shapes: Any) -> str:
    prefix = "Presentation Theme Marker {"
    for shape in shapes:
        name = shape.name or ""
        if name.startswith(prefix) and name.endswith("}"):
            return name[len(prefix) : -1]
    return ""


def shape_minimum_font(shape: Any) -> float | None:
    if not getattr(shape, "has_text_frame", False) or not shape.text_frame.text.strip():
        return None
    sizes = [
        run.font.size.pt
        for paragraph in shape.text_frame.paragraphs
        for run in paragraph.runs
        if run.text.strip() and run.font.size is not None
    ]
    return min(sizes) if sizes else None


def shape_fill_rgb(shape: Any) -> tuple[int, int, int] | None:
    try:
        color = shape.fill.fore_color.rgb
    except (AttributeError, TypeError, ValueError):
        return None
    if color is None:
        return None
    try:
        return tuple(int(channel) for channel in color)
    except (TypeError, ValueError):
        value = str(color)
        if len(value) != 6:
            return None
        try:
            return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
        except ValueError:
            return None


def relative_luminance(color: tuple[int, int, int]) -> float:
    channels: list[float] = []
    for value in color:
        normalized = value / 255
        channels.append(
            normalized / 12.92
            if normalized <= 0.04045
            else ((normalized + 0.055) / 1.055) ** 2.4
        )
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def color_saturation(color: tuple[int, int, int]) -> float:
    highest = max(color)
    if highest == 0:
        return 0.0
    return (highest - min(color)) / highest


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(
        args.input,
        root,
        label="--input",
        must_exist=True,
        suffixes=(".pptx",),
    )
    validate_ooxml_archive(input_path)
    maximum = bounded_integer(
        args.max_text_characters,
        minimum=50,
        maximum=5000,
        label="--max-text-characters",
    )
    pptx = require_pptx()
    try:
        presentation = pptx.Presentation(str(input_path))
    except Exception as exc:
        raise SkillError(
            "presentation_read_failed",
            "The presentation could not be opened.",
            exit_code=EXIT_PRESENTATION,
            details={"path": str(input_path), "reason": str(exc)},
        ) from exc

    slide_results: list[dict[str, Any]] = []
    layout_counts: Counter[str] = Counter()
    total_text_shapes = 0
    total_picture_shapes = 0
    total_brand_picture_shapes = 0
    total_content_picture_shapes = 0
    keywords = presentation.core_properties.keywords or ""
    profile = profile_from_keywords(keywords)
    theme = theme_from_keywords(keywords)
    marker_present = has_presentation_marker(keywords)
    for slide_index, slide in enumerate(presentation.slides, start=1):
        layout = infer_layout(slide.shapes)
        profile_marker = infer_profile_marker(slide.shapes)
        theme_marker = infer_theme_marker(slide.shapes)
        layout_counts[layout] += 1
        title = ""
        text_shapes: list[dict[str, Any]] = []
        pictures: list[dict[str, Any]] = []
        slide_font_sizes: list[float] = []
        dark_area = 0
        strong_color_area = 0
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                raw_text = shape.text_frame.text.strip()
                if raw_text:
                    text, truncated = normalized_text(raw_text, maximum)
                    text_shapes.append({"name": shape.name, "text": text, "truncated": truncated})
                    total_text_shapes += 1
                    if not title and (shape.name or "").startswith(("ECNU Title", "Presentation Title")):
                        title = text
                    minimum_font = shape_minimum_font(shape)
                    if minimum_font is not None and not (shape.name or "").startswith(
                        ("ECNU Brand", "ECNU Footer", "ECNU Page")
                    ):
                        slide_font_sizes.append(minimum_font)
            if hasattr(shape, "image"):
                is_brand = (shape.name or "") in {
                    "ECNU Background",
                    "ECNU Logo Form A",
                    "ECNU Logo Form C",
                }
                pictures.append(
                    {
                        "name": shape.name,
                        "content_type": shape.image.content_type,
                        "size_bytes": len(shape.image.blob),
                        "kind": "brand" if is_brand else "content",
                    }
                )
                total_picture_shapes += 1
                if is_brand:
                    total_brand_picture_shapes += 1
                else:
                    total_content_picture_shapes += 1
            fill_rgb = shape_fill_rgb(shape)
            if fill_rgb is not None:
                luminance = relative_luminance(fill_rgb)
                shape_area = max(0, shape.width) * max(0, shape.height)
                if luminance < 0.22:
                    dark_area += shape_area
                elif luminance < 0.8 and color_saturation(fill_rgb) >= 0.5:
                    strong_color_area += shape_area
        slide_results.append(
            {
                "number": slide_index,
                "layout": layout,
                "profile": profile_marker,
                "theme": theme_marker,
                "profile_marker_matches_document": bool(profile) and (
                    theme_marker == theme if theme else profile_marker == profile
                ),
                "title": title,
                "minimum_content_font_pt": round(min(slide_font_sizes), 1) if slide_font_sizes else None,
                "dark_fill_area_ratio": round(
                    min(1.0, dark_area / max(1, presentation.slide_width * presentation.slide_height)),
                    4,
                ),
                "strong_color_fill_area_ratio": round(
                    min(1.0, strong_color_area / max(1, presentation.slide_width * presentation.slide_height)),
                    4,
                ),
                "speaker_notes": slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else "",
                "text_shapes": text_shapes,
                "pictures": pictures,
            }
        )

    width_inches = presentation.slide_width / 914400
    height_inches = presentation.slide_height / 914400
    emit(
        {
            "ok": True,
            "operation": "inspect",
            **path_result(input_path, root),
            "slide_count": len(presentation.slides),
            "slide_size_inches": {
                "width": round(width_inches, 3),
                "height": round(height_inches, 3),
                "aspect_ratio": round(width_inches / height_inches, 4),
            },
            "metadata": {
                "title": presentation.core_properties.title or "",
                "author": presentation.core_properties.author or "",
                "subject": presentation.core_properties.subject or "",
                "language": presentation.core_properties.language or "",
                "ecnu_generator": marker_present,
                "generator_marker": PRESENTATION_MARKER if marker_present else "",
                "profile": profile,
                "theme": theme,
            },
            "profile": profile,
            "theme": theme,
            "layout_counts": dict(sorted(layout_counts.items())),
            "text_shape_count": total_text_shapes,
            "picture_shape_count": total_picture_shapes,
            "brand_picture_shape_count": total_brand_picture_shapes,
            "content_picture_shape_count": total_content_picture_shapes,
            "slides": slide_results,
            "note": "Inspection reads OOXML structure; it does not render slides.",
        }
    )
    return 0


if __name__ == "__main__":
    run("inspect", main)
