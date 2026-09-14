from __future__ import annotations

from typing import Any

from .shared import (
    JsonArgumentParser,
    SkillError,
    atomic_save,
    emit,
    path_result,
    project_path,
    project_root,
    read_json_spec,
    require_openpyxl,
    run,
    scalar,
    append_row,
    assign_cell,
)


INVALID_TITLE_CHARS = set("[]:*?/\\")


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Create an XLSX workbook from a JSON specification.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--output", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--spec-json")
    group.add_argument("--spec-file")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def valid_sheet_name(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SkillError("invalid_sheet_name", f"{label} must be a non-empty string.")
    name = value.strip()
    if len(name) > 31 or any(character in INVALID_TITLE_CHARS for character in name):
        raise SkillError(
            "invalid_sheet_name",
            f"{label} is not a valid Excel worksheet name.",
            details={"name": name},
        )
    return name


def rows_from(value: Any, *, label: str) -> list[list[Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SkillError("invalid_rows", f"{label} must be an array of row arrays.")
    result: list[list[Any]] = []
    for row_index, row in enumerate(value, start=1):
        if not isinstance(row, list):
            raise SkillError("invalid_row", f"{label}[{row_index}] must be an array.")
        result.append(
            [
                scalar(cell, label=f"{label}[{row_index}][{column_index}]")
                for column_index, cell in enumerate(row, start=1)
            ]
        )
    return result


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    output = project_path(args.output, root, label="--output", suffix=".xlsx")
    spec = read_json_spec(inline=args.spec_json, file_path=args.spec_file, root=root)
    sheets = spec.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        raise SkillError("invalid_spec", "The create specification requires a non-empty sheets array.")

    openpyxl = require_openpyxl()
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    used_names: set[str] = set()
    row_total = 0
    created_names: list[str] = []
    try:
        properties = spec.get("properties", {})
        if properties is not None:
            if not isinstance(properties, dict):
                raise SkillError("invalid_properties", "properties must be an object.")
            for key in ("title", "creator", "subject", "description"):
                if key in properties:
                    value = properties[key]
                    if value is not None and not isinstance(value, str):
                        raise SkillError("invalid_property", f"properties.{key} must be a string or null.")
                    setattr(workbook.properties, key, value)

        for sheet_index, sheet_spec in enumerate(sheets, start=1):
            if not isinstance(sheet_spec, dict):
                raise SkillError("invalid_sheet", f"sheets[{sheet_index}] must be an object.")
            name = valid_sheet_name(sheet_spec.get("name"), label=f"sheets[{sheet_index}].name")
            folded = name.casefold()
            if folded in used_names:
                raise SkillError("duplicate_sheet", "Worksheet names must be unique.", details={"name": name})
            used_names.add(folded)
            created_names.append(name)
            worksheet = workbook.create_sheet(name)
            rows = rows_from(sheet_spec.get("rows", []), label=f"sheets[{sheet_index}].rows")
            for row in rows:
                append_row(worksheet, row)
            row_total += len(rows)

            header = sheet_spec.get("header", False)
            if not isinstance(header, bool):
                raise SkillError("invalid_header", f"sheets[{sheet_index}].header must be boolean.")
            if header and rows:
                for cell in worksheet[1]:
                    cell.font = openpyxl.styles.Font(bold=True)
                    cell.fill = openpyxl.styles.PatternFill("solid", fgColor="E9EEF5")

            freeze_panes = sheet_spec.get("freeze_panes")
            if freeze_panes is not None:
                if not isinstance(freeze_panes, str) or not freeze_panes.strip():
                    raise SkillError(
                        "invalid_freeze_panes",
                        f"sheets[{sheet_index}].freeze_panes must be a cell coordinate or null.",
                    )
                try:
                    openpyxl.utils.cell.coordinate_from_string(freeze_panes)
                except ValueError as exc:
                    raise SkillError(
                        "invalid_freeze_panes",
                        f"sheets[{sheet_index}].freeze_panes is not a valid cell coordinate.",
                    ) from exc
                worksheet.freeze_panes = freeze_panes

            auto_filter = sheet_spec.get("auto_filter", False)
            if not isinstance(auto_filter, bool):
                raise SkillError("invalid_auto_filter", f"sheets[{sheet_index}].auto_filter must be boolean.")
            if auto_filter and rows and worksheet.max_column:
                worksheet.auto_filter.ref = worksheet.dimensions

            widths = sheet_spec.get("column_widths", {})
            if not isinstance(widths, dict):
                raise SkillError(
                    "invalid_column_widths",
                    f"sheets[{sheet_index}].column_widths must be an object.",
                )
            for column, width in widths.items():
                if not isinstance(column, str) or not column.isalpha():
                    raise SkillError("invalid_column", "Column width keys must be Excel column letters.")
                if isinstance(width, bool) or not isinstance(width, (int, float)) or not 0 < width <= 255:
                    raise SkillError("invalid_column_width", "Column widths must be numbers between 0 and 255.")
                worksheet.column_dimensions[column.upper()].width = float(width)

        atomic_save(workbook, output, overwrite=args.overwrite)
    finally:
        workbook.close()

    emit(
        {
            "ok": True,
            "operation": "create",
            **path_result(output, root),
            "sheet_names": created_names,
            "rows_written": row_total,
        }
    )
    return 0


if __name__ == "__main__":
    run("create", main)
