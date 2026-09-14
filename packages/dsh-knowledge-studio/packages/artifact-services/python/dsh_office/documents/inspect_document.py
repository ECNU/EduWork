from __future__ import annotations

from typing import Any

from .shared import (
    EXIT_DOCUMENT,
    JsonArgumentParser,
    SkillError,
    emit,
    path_result,
    project_path,
    project_root,
    require_docx,
    run,
    validate_ooxml_archive,
)


def bounded_integer(value: str, *, minimum: int, maximum: int, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise SkillError("invalid_arguments", f"{label} must be an integer.") from exc
    if not minimum <= parsed <= maximum:
        raise SkillError("invalid_arguments", f"{label} must be between {minimum} and {maximum}.")
    return parsed


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Inspect DOCX structure and sample text.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--max-paragraphs", default="100")
    parser.add_argument("--max-tables", default="20")
    parser.add_argument("--max-table-rows", default="20")
    parser.add_argument("--max-table-columns", default="20")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".docx")
    validate_ooxml_archive(input_path)
    max_paragraphs = bounded_integer(args.max_paragraphs, minimum=1, maximum=1000, label="--max-paragraphs")
    max_tables = bounded_integer(args.max_tables, minimum=1, maximum=100, label="--max-tables")
    max_table_rows = bounded_integer(args.max_table_rows, minimum=1, maximum=200, label="--max-table-rows")
    max_table_columns = bounded_integer(args.max_table_columns, minimum=1, maximum=100, label="--max-table-columns")
    docx = require_docx()
    try:
        document = docx.Document(str(input_path))
    except Exception as exc:
        raise SkillError(
            "document_read_failed",
            "The document could not be opened.",
            exit_code=EXIT_DOCUMENT,
            details={"path": str(input_path), "reason": str(exc)},
        ) from exc

    paragraph_sample = [
        {"index": index, "style": paragraph.style.name if paragraph.style else None, "text": paragraph.text}
        for index, paragraph in enumerate(document.paragraphs[:max_paragraphs], start=1)
    ]
    table_sample: list[dict[str, Any]] = []
    for index, table in enumerate(document.tables[:max_tables], start=1):
        rows = [[cell.text for cell in row.cells[:max_table_columns]] for row in table.rows[:max_table_rows]]
        table_sample.append(
            {
                "index": index,
                "row_count": len(table.rows),
                "column_count": len(table.columns),
                "rows": rows,
                "sample_truncated": {
                    "rows": len(table.rows) > max_table_rows,
                    "columns": len(table.columns) > max_table_columns,
                },
            }
        )
    properties = document.core_properties
    inline_shapes = list(document.inline_shapes)
    emit(
        {
            "ok": True,
            "operation": "inspect",
            **path_result(input_path, root),
            "properties": {
                "title": properties.title,
                "author": properties.author,
                "subject": properties.subject,
                "keywords": properties.keywords,
            },
            "summary": {
                "section_count": len(document.sections),
                "paragraph_count": len(document.paragraphs),
                "table_count": len(document.tables),
                "inline_image_count": len(inline_shapes),
            },
            "paragraphs": paragraph_sample,
            "tables": table_sample,
            "sample_truncated": {
                "paragraphs": len(document.paragraphs) > max_paragraphs,
                "tables": len(document.tables) > max_tables,
            },
        }
    )
    return 0


if __name__ == "__main__":
    run("inspect", main)
