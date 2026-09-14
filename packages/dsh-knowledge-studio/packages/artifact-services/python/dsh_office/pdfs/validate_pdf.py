from __future__ import annotations

import math
from typing import Any

from .shared import (
    EXIT_VALIDATION,
    JsonArgumentParser,
    emit,
    path_result,
    project_path,
    project_root,
    require_pypdf,
    run,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Validate PDF container and page-tree structure without rendering.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    return parser.parse_args()


def invalid_result(input_path: Any, root: Any, issues: list[dict[str, Any]]) -> int:
    emit(
        {
            "ok": False,
            "operation": "validate",
            "valid": False,
            **path_result(input_path, root),
            "issues": issues,
            "visual_validation": False,
        }
    )
    return EXIT_VALIDATION


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".pdf")
    pypdf = require_pypdf()
    issues: list[dict[str, Any]] = []

    try:
        with input_path.open("rb") as handle:
            header = handle.read(8)
            handle.seek(max(0, input_path.stat().st_size - 4096))
            trailer = handle.read()
    except OSError as exc:
        return invalid_result(
            input_path,
            root,
            [{"severity": "error", "code": "file_read_failed", "message": str(exc)}],
        )
    if not header.startswith(b"%PDF-"):
        issues.append({"severity": "error", "code": "missing_pdf_header", "message": "The PDF header is missing."})
    if b"%%EOF" not in trailer:
        issues.append({"severity": "error", "code": "missing_eof_marker", "message": "The PDF EOF marker is missing."})

    try:
        reader = pypdf.PdfReader(str(input_path), strict=False)
    except Exception as exc:
        issues.append(
            {"severity": "error", "code": "pdf_parse_failed", "message": "pypdf could not parse the PDF.", "reason": str(exc)}
        )
        return invalid_result(input_path, root, issues)
    if reader.is_encrypted:
        issues.append(
            {"severity": "error", "code": "encrypted_pdf_unsupported", "message": "Encrypted PDFs are not supported."}
        )
        return invalid_result(input_path, root, issues)

    try:
        page_count = len(reader.pages)
    except Exception as exc:
        issues.append(
            {"severity": "error", "code": "page_tree_invalid", "message": "The PDF page tree could not be read.", "reason": str(exc)}
        )
        return invalid_result(input_path, root, issues)
    if page_count == 0:
        issues.append({"severity": "error", "code": "no_pages", "message": "The PDF contains no pages."})
    if page_count > 5000:
        issues.append(
            {"severity": "error", "code": "too_many_pages", "message": "The PDF exceeds the managed page limit.", "count": page_count}
        )

    content_failures = 0
    for page_index, page in enumerate(reader.pages[:5000], start=1):
        try:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
                issues.append(
                    {"severity": "error", "code": "invalid_page_size", "message": "A page has an invalid media box.", "page": page_index}
                )
            page.get_contents()
        except Exception as exc:
            content_failures += 1
            if content_failures <= 20:
                issues.append(
                    {
                        "severity": "error",
                        "code": "page_content_invalid",
                        "message": "A page content stream could not be read.",
                        "page": page_index,
                        "reason": str(exc),
                    }
                )

    issues.append(
        {
            "severity": "info",
            "code": "visual_validation_not_performed",
            "message": "Structure was checked without rendering pages; visual layout was not validated.",
        }
    )
    valid = not any(issue["severity"] == "error" for issue in issues)
    emit(
        {
            "ok": valid,
            "operation": "validate",
            "valid": valid,
            **path_result(input_path, root),
            "summary": {"page_count": page_count, "content_stream_failures": content_failures},
            "issues": issues,
            "visual_validation": False,
        }
    )
    return 0 if valid else EXIT_VALIDATION


if __name__ == "__main__":
    run("validate", main)
