from __future__ import annotations

import zipfile
from typing import Any

from .shared import (
    EXIT_VALIDATION,
    JsonArgumentParser,
    emit,
    path_result,
    project_path,
    project_root,
    require_openpyxl,
    run,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Validate structure and obvious formula errors in an XLSX workbook.")
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
        }
    )
    return EXIT_VALIDATION


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".xlsx")
    openpyxl = require_openpyxl()
    issues: list[dict[str, Any]] = []

    if not zipfile.is_zipfile(input_path):
        return invalid_result(
            input_path,
            root,
            [
                {
                    "severity": "error",
                    "code": "invalid_xlsx_container",
                    "message": "The file is not a valid XLSX ZIP container.",
                }
            ],
        )

    try:
        workbook = openpyxl.load_workbook(input_path, read_only=True, data_only=False)
    except Exception as exc:
        return invalid_result(
            input_path,
            root,
            [
                {
                    "severity": "error",
                    "code": "workbook_parse_failed",
                    "message": "openpyxl could not parse the workbook.",
                    "reason": str(exc),
                }
            ],
        )

    formula_count = 0
    populated_cells = 0
    external_formula_count = 0
    broken_reference_count = 0
    visible_sheets = 0
    sheet_names: list[str] = []
    try:
        sheet_names = list(workbook.sheetnames)
        visible_sheets = sum(1 for sheet in workbook.worksheets if sheet.sheet_state == "visible")
        if visible_sheets == 0:
            issues.append(
                {
                    "severity": "error",
                    "code": "no_visible_sheet",
                    "message": "The workbook has no visible worksheet.",
                }
            )

        for sheet in workbook.worksheets:
            for row in sheet.iter_rows():
                for cell in row:
                    value = cell.value
                    if value is None:
                        continue
                    populated_cells += 1
                    if cell.data_type == "f":
                        formula_count += 1
                        formula = str(value)
                        if "#REF!" in formula:
                            broken_reference_count += 1
                            if broken_reference_count <= 20:
                                issues.append(
                                    {
                                        "severity": "error",
                                        "code": "broken_formula_reference",
                                        "message": "A formula contains #REF!.",
                                        "sheet": sheet.title,
                                        "cell": cell.coordinate,
                                    }
                                )
                        if "[" in formula and "]" in formula:
                            external_formula_count += 1
                    elif cell.data_type == "e" and len(issues) < 100:
                        issues.append(
                            {
                                "severity": "warning",
                                "code": "stored_cell_error",
                                "message": "A cell contains an Excel error value.",
                                "sheet": sheet.title,
                                "cell": cell.coordinate,
                                "value": value,
                            }
                        )

        if populated_cells == 0:
            issues.append(
                {
                    "severity": "warning",
                    "code": "empty_workbook",
                    "message": "The workbook contains no populated cells.",
                }
            )
        if formula_count:
            issues.append(
                {
                    "severity": "info",
                    "code": "formulas_not_calculated",
                    "message": "Formulas were preserved but not calculated by openpyxl.",
                    "count": formula_count,
                }
            )
        if external_formula_count:
            issues.append(
                {
                    "severity": "warning",
                    "code": "external_formula_references",
                    "message": "Some formulas appear to reference external workbooks.",
                    "count": external_formula_count,
                }
            )
    finally:
        workbook.close()

    valid = not any(issue["severity"] == "error" for issue in issues)
    emit(
        {
            "ok": valid,
            "operation": "validate",
            "valid": valid,
            **path_result(input_path, root),
            "summary": {
                "sheet_count": len(sheet_names),
                "visible_sheet_count": visible_sheets,
                "populated_cells": populated_cells,
                "formula_count": formula_count,
                "broken_reference_count": broken_reference_count,
                "external_formula_count": external_formula_count,
            },
            "issues": issues,
        }
    )
    return 0 if valid else EXIT_VALIDATION


if __name__ == "__main__":
    run("validate", main)
