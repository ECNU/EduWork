from __future__ import annotations

import hashlib
import math
import unicodedata
import zipfile
from typing import Any

from .inspect_presentation import infer_layout, infer_profile_marker, infer_theme_marker
from .shared import (
    EXIT_VALIDATION,
    JsonArgumentParser,
    PRESENTATION_MARKER,
    SUPPORTED_PROFILES,
    SUPPORTED_THEMES,
    asset_path,
    emit,
    has_presentation_marker,
    path_result,
    project_path,
    project_root,
    require_pptx,
    run,
    sha256_file,
    profile_from_keywords,
    theme_from_keywords,
    validate_ooxml_archive,
)


EMU_PER_INCH = 914400
EXPECTED_RATIO = 16 / 9
KNOWN_LAYOUTS = {
    "cover",
    "section",
    "bullets",
    "summary",
    "two-column",
    "metrics",
    "timeline",
    "feature-grid",
    "roadmap",
    "image",
    "quote",
    "closing",
}
STRUCTURAL_LAYOUTS = {"cover", "section", "closing"}
VISUAL_COMPOSITION_LAYOUTS = {"image", "timeline", "feature-grid", "roadmap"}


def parse_args() -> Any:
    parser = JsonArgumentParser(
        description="Validate hard PPTX constraints and report non-blocking design warnings."
    )
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def invalid_result(input_path: Any, root: Any, issues: list[dict[str, Any]]) -> int:
    emit(
        {
            "ok": False,
            "operation": "validate",
            "valid": False,
            **path_result(input_path, root),
            "issues": issues,
        }
    )
    return EXIT_VALIDATION


def weighted_length(text: str) -> float:
    total = 0.0
    for character in text:
        if character in "\r\n":
            continue
        width = unicodedata.east_asian_width(character)
        total += 1.0 if width in {"W", "F", "A"} else 0.55
    return total


def font_size_for(paragraph: Any) -> float:
    sizes = [run.font.size.pt for run in paragraph.runs if run.font.size is not None]
    return max(sizes) if sizes else 18.0


def overflow_risk(shape: Any) -> dict[str, Any] | None:
    if not getattr(shape, "has_text_frame", False) or not shape.text_frame.text.strip():
        return None
    width_inches = max(shape.width / EMU_PER_INCH, 0.05)
    height_inches = max(shape.height / EMU_PER_INCH, 0.05)
    required_lines = 0
    largest_font = 1.0
    for paragraph in shape.text_frame.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        font_size = font_size_for(paragraph)
        largest_font = max(largest_font, font_size)
        units_per_line = max(1.0, width_inches * 72 / (font_size * 0.82))
        explicit_lines = text.splitlines() or [""]
        required_lines += sum(max(1, math.ceil(weighted_length(line) / units_per_line)) for line in explicit_lines)
    capacity_lines = max(1, math.floor(height_inches * 72 / (largest_font * 1.23)))
    if required_lines <= capacity_lines:
        return None
    return {
        "required_lines_estimate": required_lines,
        "capacity_lines_estimate": capacity_lines,
        "font_size_pt": round(largest_font, 1),
    }


def embedded_media_hashes(input_path: Any) -> set[str]:
    result: set[str] = set()
    with zipfile.ZipFile(input_path) as archive:
        for name in archive.namelist():
            if not name.startswith("ppt/media/") or name.endswith("/"):
                continue
            result.add(hashlib.sha256(archive.read(name)).hexdigest())
    return result


def picture_hash(shape: Any) -> str:
    try:
        return hashlib.sha256(shape.image.blob).hexdigest()
    except Exception:
        return ""


def minimum_font_size(shape: Any) -> float | None:
    if not getattr(shape, "has_text_frame", False) or not shape.text_frame.text.strip():
        return None
    sizes = [
        run.font.size.pt
        for paragraph in shape.text_frame.paragraphs
        for run in paragraph.runs
        if run.text.strip() and run.font.size is not None
    ]
    return min(sizes) if sizes else None


def minimum_required_font(shape_name: str, layout: str) -> float | None:
    if shape_name.startswith(("ECNU Title", "Presentation Title")):
        if layout == "cover":
            return 36
        if layout in {"quote", "image"}:
            return 26
        return 30
    if "Bullets" in shape_name:
        return 16
    if "Heading" in shape_name or "Feature Title" in shape_name or "Roadmap Title" in shape_name:
        return 18
    if "Metric Label" in shape_name:
        return 15
    if "Metric Detail" in shape_name:
        return 11
    if any(token in shape_name for token in ("Feature Detail", "Timeline Detail", "Roadmap Detail")):
        return 12
    return None


def solid_fill_rgb(shape: Any) -> tuple[int, int, int] | None:
    try:
        color = shape.fill.fore_color.rgb
    except (AttributeError, TypeError, ValueError):
        return None
    if color is None:
        return None
    try:
        return tuple(int(channel) for channel in color)
    except (TypeError, ValueError):
        try:
            value = str(color)
            if len(value) == 6:
                return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
        except ValueError:
            return None
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


def matching_fill_area_ratio(slide: Any, slide_area: int, predicate: Any) -> float:
    matching_area = 0
    for shape in slide.shapes:
        color = solid_fill_rgb(shape)
        if color is None or not predicate(color):
            continue
        matching_area += max(0, shape.width) * max(0, shape.height)
    return min(1.0, matching_area / max(1, slide_area))


def dark_fill_area_ratio(slide: Any, slide_area: int) -> float:
    return matching_fill_area_ratio(
        slide,
        slide_area,
        lambda color: relative_luminance(color) < 0.22,
    )


def strong_color_fill_area_ratio(slide: Any, slide_area: int) -> float:
    return matching_fill_area_ratio(
        slide,
        slide_area,
        lambda color: relative_luminance(color) >= 0.22
        and relative_luminance(color) < 0.8
        and color_saturation(color) >= 0.5,
    )


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
    issues: list[dict[str, Any]] = []
    if not zipfile.is_zipfile(input_path):
        return invalid_result(
            input_path,
            root,
            [{"severity": "error", "code": "invalid_pptx_container", "message": "The file is not a PPTX ZIP container."}],
        )

    pptx = require_pptx()
    try:
        presentation = pptx.Presentation(str(input_path))
    except Exception as exc:
        return invalid_result(
            input_path,
            root,
            [
                {
                    "severity": "error",
                    "code": "presentation_parse_failed",
                    "message": "python-pptx could not parse the presentation.",
                    "reason": str(exc),
                }
            ],
        )

    slide_count = len(presentation.slides)
    if slide_count == 0:
        issues.append({"severity": "error", "code": "no_slides", "message": "The presentation has no slides."})
    # Input planning budgets are not OOXML validity constraints. Automatic
    # readable continuation pages can legitimately exceed the input slide count.

    width_inches = presentation.slide_width / EMU_PER_INCH
    height_inches = presentation.slide_height / EMU_PER_INCH
    ratio = width_inches / height_inches
    if abs(ratio - EXPECTED_RATIO) > 0.01:
        issues.append(
            {
                "severity": "error",
                "code": "invalid_aspect_ratio",
                "message": "The presentation must use a 16:9 widescreen canvas.",
                "aspect_ratio": round(ratio, 4),
            }
        )

    media_hashes = embedded_media_hashes(input_path)
    keywords = presentation.core_properties.keywords or ""
    profile = profile_from_keywords(keywords)
    theme = theme_from_keywords(keywords)
    generated = has_presentation_marker(keywords)
    branded = generated and (not theme or theme == "ecnu-liwa")
    expected_hashes = {name: sha256_file(asset_path(name)) for name in
        ("ecnu-background.jpg", "ecnu-logo-form-a.png", "ecnu-logo-form-c.png")} if branded else {}
    if not has_presentation_marker(keywords):
        issues.append(
            {
                "severity": "error",
                "code": "generator_marker_missing",
                "message": "The required ChatECNU Work presentation generator marker is missing.",
                "expected": PRESENTATION_MARKER,
            }
        )
    if profile not in SUPPORTED_PROFILES:
        issues.append(
            {
                "severity": "error",
                "code": "presentation_profile_missing",
                "message": "The presentation does not declare one supported layout profile.",
                "supported": sorted(SUPPORTED_PROFILES),
            }
        )
    if theme and theme not in SUPPORTED_THEMES:
        issues.append(
            {
                "severity": "error",
                "code": "presentation_theme_missing",
                "message": "The presentation does not declare one supported theme.",
                "supported": sorted(SUPPORTED_THEMES),
            }
        )
    if branded and expected_hashes["ecnu-background.jpg"] not in media_hashes:
        issues.append(
            {
                "severity": "error",
                "code": "ecnu_background_missing",
                "message": "The official ECNU background asset is not embedded in the presentation.",
            }
        )
    if branded and not ({expected_hashes["ecnu-logo-form-a.png"], expected_hashes["ecnu-logo-form-c.png"]} & media_hashes):
        issues.append(
            {
                "severity": "error",
                "code": "ecnu_logo_missing",
                "message": "No official ECNU logo asset is embedded in the presentation.",
            }
        )

    overflow_warnings = 0
    out_of_bounds = 0
    missing_brand_shapes = 0
    undersized_text_count = 0
    excessive_dark_surface_count = 0
    excessive_strong_color_surface_count = 0
    severe_text_overflow_count = 0
    content_picture_count = 0
    layout_counts: dict[str, int] = {}
    layout_sequence: list[str] = []
    slide_area = presentation.slide_width * presentation.slide_height
    for slide_index, slide in enumerate(presentation.slides, start=1):
        layout = infer_layout(slide.shapes)
        layout_sequence.append(layout)
        profile_marker = infer_profile_marker(slide.shapes)
        theme_marker = infer_theme_marker(slide.shapes)
        marker_prefix = "Presentation Theme Marker {" if theme else "ECNU Profile Marker {"
        marker_names = [shape.name or "" for shape in slide.shapes if (shape.name or "").startswith(marker_prefix)]
        layout_counts[layout] = layout_counts.get(layout, 0) + 1
        if layout not in KNOWN_LAYOUTS:
            issues.append(
                {
                    "severity": "error",
                    "code": "unknown_layout",
                    "message": "The slide does not contain a supported layout marker.",
                    "slide": slide_index,
                }
            )
        expected_marker = f"Presentation Theme Marker {{{theme}}}" if theme else (f"ECNU Profile Marker {{{profile}}}" if profile else "")
        actual_marker = theme_marker if theme else profile_marker
        if (
            not profile
            or actual_marker != (theme if theme else profile)
            or marker_names != [expected_marker]
        ):
            issues.append(
                {
                    "severity": "error",
                    "code": "slide_profile_marker_mismatch",
                    "message": "The slide must contain exactly one marker matching the document style.",
                    "slide": slide_index,
                    "document_profile": profile,
                    "document_theme": theme,
                    "slide_profile": profile_marker,
                    "slide_theme": theme_marker,
                    "marker_count": len(marker_names),
                }
            )
        backgrounds = [shape for shape in slide.shapes if (shape.name or "") == "ECNU Background"]
        if branded and len(backgrounds) != 1:
            missing_brand_shapes += 1
            issues.append(
                {
                    "severity": "error",
                    "code": "slide_background_missing",
                    "message": "The slide must contain exactly one ECNU background shape.",
                    "slide": slide_index,
                }
            )
        elif branded and picture_hash(backgrounds[0]) != expected_hashes["ecnu-background.jpg"]:
            missing_brand_shapes += 1
            issues.append(
                {
                    "severity": "error",
                    "code": "slide_background_tampered",
                    "message": "The named ECNU background shape is not the fixed official background asset.",
                    "slide": slide_index,
                }
            )
        logos = [shape for shape in slide.shapes if (shape.name or "").startswith("ECNU Logo Form")]
        if branded and len(logos) != 1:
            missing_brand_shapes += 1
            issues.append(
                {
                    "severity": "error",
                    "code": "slide_logo_missing",
                    "message": "The slide must contain exactly one ECNU logo shape.",
                    "slide": slide_index,
                }
            )
        elif branded and picture_hash(logos[0]) not in {
            expected_hashes["ecnu-logo-form-a.png"],
            expected_hashes["ecnu-logo-form-c.png"],
        }:
            missing_brand_shapes += 1
            issues.append(
                {
                    "severity": "error",
                    "code": "slide_logo_tampered",
                    "message": "The named ECNU logo shape is not one of the fixed official logo assets.",
                    "slide": slide_index,
                }
            )
        # A title is editorial content, not a readable-file requirement. A
        # title-free semantic slide can carry its full meaning in body content.

        content_picture_count += sum(
            1 for shape in slide.shapes if (shape.name or "") == "ECNU Content Image [image]"
        )
        dark_ratio = dark_fill_area_ratio(slide, slide_area)
        dark_limit = 0.45 if layout in {"cover", "section", "quote", "closing"} else 0.25
        if dark_ratio > dark_limit:
            excessive_dark_surface_count += 1
            issues.append(
                {
                    "severity": "warning",
                    "category": "quality",
                    "code": "excessive_dark_surface",
                    "message": "Dark filled shapes cover too much of the ECNU white-and-red slide canvas.",
                    "slide": slide_index,
                    "layout": layout,
                    "dark_fill_area_ratio": round(dark_ratio, 4),
                    "maximum": dark_limit,
                }
            )
        strong_color_ratio = strong_color_fill_area_ratio(slide, slide_area)
        strong_color_limit = 0.2
        if strong_color_ratio > strong_color_limit:
            excessive_strong_color_surface_count += 1
            issues.append(
                {
                    "severity": "warning",
                    "category": "quality",
                    "code": "excessive_strong_color_surface",
                    "message": "Highly saturated filled shapes cover too much of the white-dominant ECNU canvas.",
                    "slide": slide_index,
                    "layout": layout,
                    "strong_color_fill_area_ratio": round(strong_color_ratio, 4),
                    "maximum": strong_color_limit,
                }
            )

        for shape in slide.shapes:
            if shape.left < 0 or shape.top < 0 or shape.left + shape.width > presentation.slide_width or shape.top + shape.height > presentation.slide_height:
                out_of_bounds += 1
                if out_of_bounds <= 20:
                    issues.append(
                        {
                            "severity": "error",
                            "code": "shape_out_of_bounds",
                            "message": "A shape extends beyond the slide canvas.",
                            "slide": slide_index,
                            "shape": shape.name,
                        }
                    )
            if not (shape.name or "").startswith(("ECNU Text", "ECNU Title", "ECNU Footer", "ECNU Brand", "ECNU Page", "Presentation Text", "Presentation Title")):
                continue
            risk = overflow_risk(shape)
            if risk is not None:
                overflow_warnings += 1
                severe_overflow = (
                    risk["required_lines_estimate"] >= risk["capacity_lines_estimate"] + 2
                    and risk["required_lines_estimate"] / risk["capacity_lines_estimate"] >= 1.5
                )
                if severe_overflow:
                    severe_text_overflow_count += 1
                if overflow_warnings <= 30:
                    issue = {
                        "severity": "error" if severe_overflow else "warning",
                        "code": "text_overflow_risk",
                        "message": (
                            "Text substantially exceeds the fixed text-box capacity."
                            if severe_overflow
                            else "Text may overflow its fixed text box; verify with a real renderer."
                        ),
                        "slide": slide_index,
                        "shape": shape.name,
                        **risk,
                    }
                    issue["category"] = "rendering" if severe_overflow else "quality"
                    issues.append(issue)
            required_font = minimum_required_font(shape.name or "", layout)
            actual_font = minimum_font_size(shape)
            if required_font is not None and actual_font is not None and actual_font < required_font:
                undersized_text_count += 1
                if undersized_text_count <= 30:
                    issues.append(
                        {
                            "severity": "warning",
                            "category": "quality",
                            "code": "content_font_below_minimum",
                            "message": "Audience-facing text is smaller than the fixed projection-safe minimum.",
                            "slide": slide_index,
                            "layout": layout,
                            "shape": shape.name,
                            "font_size_pt": round(actual_font, 1),
                            "minimum_pt": required_font,
                        }
                    )

    content_slide_count = slide_count - sum(layout_counts.get(layout, 0) for layout in STRUCTURAL_LAYOUTS)
    visual_composition_count = sum(layout_counts.get(layout, 0) for layout in VISUAL_COMPOSITION_LAYOUTS)
    if slide_count >= 12:
        required_visuals = max(2, slide_count // 8)
        if visual_composition_count < required_visuals:
            issues.append(
                {
                    "severity": "warning",
                    "category": "quality",
                    "code": "too_few_visual_compositions",
                    "message": "Long decks need semantic visual compositions or image evidence instead of repeated text pages.",
                    "count": visual_composition_count,
                    "minimum": required_visuals,
                }
            )
        section_limit = max(3, math.ceil(slide_count / 5))
        if layout_counts.get("section", 0) > section_limit:
            issues.append(
                {
                    "severity": "warning",
                    "category": "quality",
                    "code": "too_many_section_slides",
                    "message": "Low-information section dividers exceed the long-deck limit.",
                    "count": layout_counts.get("section", 0),
                    "maximum": section_limit,
                }
            )
        if content_slide_count >= 8 and layout_counts.get("bullets", 0) / content_slide_count > 0.4:
            issues.append(
                {
                    "severity": "warning",
                    "category": "quality",
                    "code": "too_many_bullet_slides",
                    "message": "Bullet slides exceed 40% of content slides.",
                    "count": layout_counts.get("bullets", 0),
                    "content_slide_count": content_slide_count,
                }
            )
        if slide_count >= 16:
            distinct_content = {
                layout for layout in layout_sequence if layout not in STRUCTURAL_LAYOUTS and layout in KNOWN_LAYOUTS
            }
            if len(distinct_content) < 5:
                issues.append(
                    {
                        "severity": "warning",
                        "category": "quality",
                        "code": "insufficient_layout_variety",
                        "message": "Long decks need at least five distinct content layouts.",
                        "count": len(distinct_content),
                        "minimum": 5,
                        "layouts": sorted(distinct_content),
                    }
                )

    longest_run = 1
    run_layout = ""
    run_length = 0
    for layout in layout_sequence:
        if layout == run_layout:
            run_length += 1
        else:
            run_layout = layout
            run_length = 1
        longest_run = max(longest_run, run_length)
    if longest_run > 2:
        issues.append(
            {
                "severity": "warning",
                "category": "quality",
                "code": "repeated_layout_run",
                "message": "The same layout appears more than twice in a row.",
                "longest_run": longest_run,
                "maximum": 2,
            }
        )

    issues.append(
        {
            "severity": "info",
            "code": "structural_validation_only",
            "message": "Validation checks OOXML, fixed layout bounds, theme markers, optional brand assets, and estimated text capacity; it does not render slides.",
        }
    )

    template_only = {"invalid_aspect_ratio", "generator_marker_missing", "presentation_profile_missing",
        "presentation_theme_missing", "unknown_layout", "slide_profile_marker_mismatch"}
    for issue in issues:
        if issue['code'] in template_only:
            issue.update(severity='warning', category='quality')
    if not generated:
        issues = [item for item in issues if item["code"] not in template_only and item.get("category") != "quality"]
    hard_errors = [
        issue
        for issue in issues
        if issue["severity"] == "error" and issue.get("category") != "quality"
    ]
    structural_valid = not hard_errors
    quality_warnings = [issue for issue in issues if issue.get("category") == "quality"]
    quality_pass = not quality_warnings
    valid = structural_valid
    strict_pass = structural_valid and quality_pass
    command_pass = strict_pass if args.strict else valid
    emit(
        {
            "ok": command_pass,
            "operation": "validate",
            "mode": "strict" if args.strict else "standard",
            "valid": valid,
            **path_result(input_path, root),
            "profile": profile,
            "theme": theme,
            "structural_valid": structural_valid,
            "quality_pass": quality_pass,
            "strict_pass": strict_pass,
            "summary": {
                "slide_count": slide_count,
                "profile": profile,
                "theme": theme,
                "layout_counts": dict(sorted(layout_counts.items())),
                "aspect_ratio": round(ratio, 4),
                "embedded_media_count": len(media_hashes),
                "content_picture_count": content_picture_count,
                "visual_composition_count": visual_composition_count,
                "missing_brand_shape_count": missing_brand_shapes,
                "shape_out_of_bounds_count": out_of_bounds,
                "text_overflow_risk_count": overflow_warnings,
                "severe_text_overflow_count": severe_text_overflow_count,
                "undersized_text_count": undersized_text_count,
                "excessive_dark_surface_slide_count": excessive_dark_surface_count,
                "excessive_strong_color_surface_slide_count": excessive_strong_color_surface_count,
                "longest_repeated_layout_run": longest_run,
                "hard_error_count": len(hard_errors),
                "quality_warning_count": len(quality_warnings),
            },
            "hard_errors": hard_errors,
            "quality_warnings": quality_warnings,
            "issues": issues,
        }
    )
    return 0 if command_pass else EXIT_VALIDATION


if __name__ == "__main__":
    run("validate", main)
