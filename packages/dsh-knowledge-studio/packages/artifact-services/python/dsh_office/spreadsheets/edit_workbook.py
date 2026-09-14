from __future__ import annotations

from typing import Any

from .shared import (
    EXIT_WORKBOOK,
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
from .create_workbook import rows_from, valid_sheet_name


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Edit an XLSX workbook using ordered JSON operations.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--spec-json")
    group.add_argument("--spec-file")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def worksheet(workbook: Any, name: Any, *, label: str) -> Any:
    if not isinstance(name, str) or name not in workbook.sheetnames:
        raise SkillError(
            "sheet_not_found",
            f"{label} does not identify an existing worksheet.",
            details={"sheet": name},
        )
    return workbook[name]


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".xlsx")
    output = project_path(args.output, root, label="--output", suffix=".xlsx")
    spec = read_json_spec(inline=args.spec_json, file_path=args.spec_file, root=root)
    operations = spec.get("operations")
    if not isinstance(operations, list) or not operations:
        raise SkillError("invalid_spec", "The edit specification requires a non-empty operations array.")
    openpyxl = require_openpyxl()
    try:
        workbook = openpyxl.load_workbook(input_path, data_only=False)
    except Exception as exc:
        raise SkillError(
            "workbook_read_failed",
            "The workbook could not be opened.",
            exit_code=EXIT_WORKBOOK,
            details={"path": str(input_path), "reason": str(exc)},
        ) from exc

    counts: dict[str, int] = {}
    sheet_names: list[str] = []
    try:
        for index, operation in enumerate(operations, start=1):
            if not isinstance(operation, dict):
                raise SkillError("invalid_operation", f"operations[{index}] must be an object.")
            kind = operation.get("op")
            if not isinstance(kind, str):
                raise SkillError("invalid_operation", f"operations[{index}].op must be a string.")

            if kind == "set":
                sheet = worksheet(workbook, operation.get("sheet"), label=f"operations[{index}].sheet")
                coordinate = operation.get("cell")
                if not isinstance(coordinate, str):
                    raise SkillError("invalid_cell", f"operations[{index}].cell must be a coordinate.")
                try:
                    openpyxl.utils.cell.coordinate_from_string(coordinate)
                except ValueError as exc:
                    raise SkillError("invalid_cell", f"operations[{index}].cell is invalid.") from exc
                assign_cell(sheet[coordinate], scalar(operation.get("value"), label=f"operations[{index}].value"))

            elif kind == "append_rows":
                sheet = worksheet(workbook, operation.get("sheet"), label=f"operations[{index}].sheet")
                rows = rows_from(operation.get("rows"), label=f"operations[{index}].rows")
                if not rows:
                    raise SkillError("invalid_rows", f"operations[{index}].rows must not be empty.")
                for row in rows:
                    append_row(sheet, row)

            elif kind == "create_sheet":
                name = valid_sheet_name(operation.get("name"), label=f"operations[{index}].name")
                if name.casefold() in {item.casefold() for item in workbook.sheetnames}:
                    raise SkillError("duplicate_sheet", "The worksheet already exists.", details={"name": name})
                sheet = workbook.create_sheet(name)
                for row in rows_from(operation.get("rows", []), label=f"operations[{index}].rows"):
                    append_row(sheet, row)

            elif kind == "rename_sheet":
                sheet = worksheet(workbook, operation.get("sheet"), label=f"operations[{index}].sheet")
                name = valid_sheet_name(operation.get("name"), label=f"operations[{index}].name")
                if name.casefold() in {
                    item.casefold() for item in workbook.sheetnames if item.casefold() != sheet.title.casefold()
                }:
                    raise SkillError("duplicate_sheet", "The worksheet already exists.", details={"name": name})
                sheet.title = name

            elif kind == "delete_sheet":
                if len(workbook.worksheets) == 1:
                    raise SkillError("last_sheet", "The last worksheet cannot be deleted.")
                sheet = worksheet(workbook, operation.get("sheet"), label=f"operations[{index}].sheet")
                workbook.remove(sheet)

            else:
                raise SkillError(
                    "unsupported_operation",
                    f"operations[{index}].op is not supported.",
                    details={
                        "op": kind,
                        "supported": ["set", "append_rows", "create_sheet", "rename_sheet", "delete_sheet"],
                    },
                )
            counts[kind] = counts.get(kind, 0) + 1

        atomic_save(workbook, output, overwrite=args.overwrite)
        sheet_names = list(workbook.sheetnames)
    finally:
        workbook.close()

    emit(
        {
            "ok": True,
            "operation": "edit",
            **path_result(output, root),
            "source": input_path.relative_to(root).as_posix(),
            "operations_applied": len(operations),
            "operation_counts": counts,
            "sheet_names": sheet_names,
        }
    )
    return 0


if __name__ == "__main__":
    run("edit", main)
