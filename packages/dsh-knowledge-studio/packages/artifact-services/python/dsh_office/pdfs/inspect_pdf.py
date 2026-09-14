from __future__ import annotations

from typing import Any

from .shared import (
    JsonArgumentParser,
    SkillError,
    bounded_integer,
    emit,
    path_result,
    project_path,
    project_root,
    reader_from,
    require_pypdf,
    run,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Inspect PDF metadata, page sizes, and bounded text samples.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--max-pages", default="20")
    parser.add_argument("--max-chars", default="4000")
    return parser.parse_args()


def metadata_from(reader: Any) -> dict[str, str | None]:
    try:
        metadata = reader.metadata or {}
    except Exception:
        return {}
    result: dict[str, str | None] = {}
    for source_key, target_key in (
        ("/Title", "title"),
        ("/Author", "author"),
        ("/Subject", "subject"),
        ("/Creator", "creator"),
        ("/Producer", "producer"),
    ):
        value = metadata.get(source_key)
        result[target_key] = None if value is None else str(value)[:4096]
    return result


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".pdf")
    max_pages = bounded_integer(args.max_pages, minimum=1, maximum=200, label="--max-pages")
    max_chars = bounded_integer(args.max_chars, minimum=100, maximum=50000, label="--max-chars")
    pypdf = require_pypdf()
    reader = reader_from(pypdf, input_path)

    pages: list[dict[str, Any]] = []
    remaining = max_chars
    text_pages = 0
    warnings: list[dict[str, Any]] = []
    for index, page in enumerate(reader.pages[:max_pages], start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        text = ""
        if remaining > 0:
            try:
                text = page.extract_text() or ""
            except Exception as exc:
                warnings.append(
                    {"code": "text_extraction_failed", "page": index, "message": str(exc)[:1000]}
                )
            if text:
                text_pages += 1
            text = text[:remaining]
            remaining -= len(text)
        pages.append(
            {
                "page": index,
                "width_points": round(width, 3),
                "height_points": round(height, 3),
                "width_mm": round(width * 25.4 / 72, 2),
                "height_mm": round(height * 25.4 / 72, 2),
                "text_sample": text,
            }
        )

    page_count = len(reader.pages)
    emit(
        {
            "ok": True,
            "operation": "inspect",
            **path_result(input_path, root),
            "page_count": page_count,
            "metadata": metadata_from(reader),
            "pages": pages,
            "sample_truncated": {"pages": page_count > max_pages, "characters": remaining == 0},
            "pages_with_extractable_text_in_sample": text_pages,
            "warnings": warnings,
            "visual_validation": False,
        }
    )
    return 0


if __name__ == "__main__":
    run("inspect", main)
