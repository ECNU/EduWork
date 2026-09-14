from __future__ import annotations

from typing import Any

from .shared import (
    EXIT_WORKBOOK,
    JsonArgumentParser,
    SkillError,
    emit,
    json_value,
    path_result,
    project_path,
    project_root,
    require_openpyxl,
    run,
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
    parser = JsonArgumentParser(description="Inspect workbook structure and sample cell values.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--max-rows", default="20")
    parser.add_argument("--max-columns", default="20")
    parser.add_argument(
        "--data-only",
        action="store_true",
        help="Return cached formula values instead of formula expressions when available.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".xlsx")
    max_rows = bounded_integer(args.max_rows, minimum=1, maximum=200, label="--max-rows")
    max_columns = bounded_integer(args.max_columns, minimum=1, maximum=100, label="--max-columns")
    openpyxl = require_openpyxl()
    try:
        workbook = openpyxl.load_workbook(input_path, read_only=True, data_only=args.data_only)
    except Exception as exc:
        raise SkillError(
            "workbook_read_failed",
            "The workbook could not be opened.",
            exit_code=EXIT_WORKBOOK,
            details={"path": str(input_path), "reason": str(exc)},
        ) from exc

    sheet_results: list[dict[str, Any]] = []
    properties = {
        "title": workbook.properties.title,
        "creator": workbook.properties.creator,
        "subject": workbook.properties.subject,
    }
    try:
        for worksheet in workbook.worksheets:
            sample: list[list[Any]] = []
            if worksheet.max_row and worksheet.max_column:
                for row in worksheet.iter_rows(
                    min_row=1,
                    max_row=min(worksheet.max_row, max_rows),
                    max_col=min(worksheet.max_column, max_columns),
                    values_only=True,
                ):
                    sample.append([json_value(value) if value is not None else None for value in row])
                if sample and all(all(value is None for value in row) for row in sample):
                    sample = []
            sheet_results.append(
                {
                    "name": worksheet.title,
                    "state": worksheet.sheet_state,
                    "max_row": worksheet.max_row,
                    "max_column": worksheet.max_column,
                    "sample": sample,
                    "sample_truncated": {
                        "rows": worksheet.max_row > max_rows,
                        "columns": worksheet.max_column > max_columns,
                    },
                }
            )
    finally:
        workbook.close()

    emit(
        {
            "ok": True,
            "operation": "inspect",
            **path_result(input_path, root),
            "data_only": args.data_only,
            "properties": properties,
            "sheets": sheet_results,
        }
    )
    return 0


if __name__ == "__main__":
    run("inspect", main)
