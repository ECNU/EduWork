"""Shared validation and JSON helpers for managed spreadsheet modules."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable


EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
EXIT_WORKBOOK = 4
EXIT_OUTPUT = 5
EXIT_VALIDATION = 6
EXIT_DEPENDENCY = 10


class SkillError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_USAGE,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details or {}


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise SkillError("invalid_arguments", message, exit_code=EXIT_USAGE)


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    return str(value)


def emit(payload: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    stream.write(json.dumps(payload, ensure_ascii=False, default=json_value) + "\n")
    stream.flush()


def run(operation: str, function: Callable[[], int | None]) -> None:
    try:
        result = function()
    except SkillError as exc:
        payload: dict[str, Any] = {
            "ok": False,
            "operation": operation,
            "error": {"code": exc.code, "message": exc.message},
        }
        if exc.details:
            payload["error"]["details"] = exc.details
        emit(payload, stream=sys.stderr)
        raise SystemExit(exc.exit_code)
    except KeyboardInterrupt:
        emit(
            {
                "ok": False,
                "operation": operation,
                "error": {"code": "cancelled", "message": "Operation was cancelled."},
            },
            stream=sys.stderr,
        )
        raise SystemExit(130)
    except Exception as exc:
        emit(
            {
                "ok": False,
                "operation": operation,
                "error": {"code": "internal_error", "message": str(exc)},
            },
            stream=sys.stderr,
        )
        raise SystemExit(1)
    raise SystemExit(0 if result is None else result)


def require_openpyxl() -> Any:
    try:
        import openpyxl
    except ImportError as exc:
        raise SkillError(
            "dependency_missing",
            "openpyxl is required in the managed Python environment.",
            exit_code=EXIT_DEPENDENCY,
            details={"package": "openpyxl", "recovery": "install python/requirements.txt into the interpreter configured by DSH_OFFICE_PYTHON"},
        ) from exc
    return openpyxl


def project_root(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise SkillError("absolute_path_required", "--project-root must be an absolute path.")
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise SkillError(
            "project_not_found",
            "The project root does not exist.",
            exit_code=EXIT_NOT_FOUND,
            details={"path": str(path)},
        ) from exc
    if not resolved.is_dir():
        raise SkillError("invalid_project_root", "The project root is not a directory.")
    return resolved


def project_path(
    raw: str,
    root: Path,
    *,
    label: str,
    must_exist: bool = False,
    suffix: str | None = None,
) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise SkillError("absolute_path_required", f"{label} must be an absolute path.")
    resolved = path.resolve(strict=False)
    try:
        common = os.path.commonpath((str(root), str(resolved)))
    except ValueError as exc:
        raise SkillError("path_outside_project", f"{label} is outside the project root.") from exc
    if os.path.normcase(common) != os.path.normcase(str(root)):
        raise SkillError(
            "path_outside_project",
            f"{label} is outside the project root.",
            details={"path": str(resolved)},
        )
    if suffix and resolved.suffix.lower() != suffix:
        raise SkillError(
            "invalid_file_type",
            f"{label} must use the {suffix} extension.",
            details={"path": str(resolved)},
        )
    if must_exist:
        if not resolved.exists():
            raise SkillError(
                "file_not_found",
                f"{label} does not exist.",
                exit_code=EXIT_NOT_FOUND,
                details={"path": str(resolved)},
            )
        if not resolved.is_file():
            raise SkillError("not_a_file", f"{label} is not a file.")
    return resolved


def read_json_spec(
    *,
    inline: str | None,
    file_path: str | None,
    root: Path,
) -> dict[str, Any]:
    if bool(inline) == bool(file_path):
        raise SkillError(
            "invalid_arguments",
            "Provide exactly one of --spec-json or --spec-file.",
        )
    source = "inline JSON"
    text = inline
    if file_path:
        spec_path = project_path(file_path, root, label="--spec-file", must_exist=True, suffix=".json")
        source = str(spec_path)
        try:
            text = spec_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise SkillError(
                "spec_read_failed",
                "The JSON specification could not be read.",
                exit_code=EXIT_NOT_FOUND,
                details={"path": str(spec_path), "reason": str(exc)},
            ) from exc
    try:
        parsed = json.loads(text or "")
    except json.JSONDecodeError as exc:
        raise SkillError(
            "invalid_json",
            "The JSON specification is invalid.",
            details={"source": source, "line": exc.lineno, "column": exc.colno, "reason": exc.msg},
        ) from exc
    if not isinstance(parsed, dict):
        raise SkillError("invalid_spec", "The JSON specification must be an object.")
    return parsed


class LiteralText(str):
    """An explicitly typed text cell; never an Excel formula."""


def assign_cell(cell: Any, value: Any) -> None:
    cell.value = str(value) if isinstance(value, LiteralText) else value
    if isinstance(value, LiteralText):
        cell.data_type = "s"


def append_row(sheet: Any, row: list[Any]) -> None:
    sheet.append([str(value) if isinstance(value, LiteralText) else value for value in row])
    for index, value in enumerate(row, start=1):
        if isinstance(value, LiteralText):
            sheet.cell(sheet.max_row, index).data_type = "s"


def scalar(value: Any, *, label: str) -> str | int | float | bool | None:
    if isinstance(value, dict):
        if set(value) != {"type", "value"} or value["type"] not in {"text", "formula"} or not isinstance(value["value"], str):
            raise SkillError("invalid_cell_value", f"{label} must be a typed text or formula cell.")
        if value["type"] == "text":
            return LiteralText(value["value"])
        if not value["value"].startswith("="):
            raise SkillError("invalid_cell_value", f"{label} formula must start with =.")
        return value["value"]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise SkillError(
        "invalid_cell_value",
        f"{label} must be a string, number, boolean, or null.",
    )


def atomic_save(workbook: Any, output: Path, *, overwrite: bool) -> None:
    if output.exists() and not overwrite:
        raise SkillError(
            "output_exists",
            "The output file already exists; pass --overwrite only after confirming replacement.",
            exit_code=EXIT_OUTPUT,
            details={"path": str(output)},
        )
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SkillError(
            "output_directory_failed",
            "The output directory could not be created.",
            exit_code=EXIT_OUTPUT,
            details={"path": str(output.parent), "reason": str(exc)},
        ) from exc

    descriptor = -1
    temporary = ""
    try:
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{output.stem}-",
            suffix=".xlsx",
            dir=str(output.parent),
        )
        os.close(descriptor)
        descriptor = -1
        workbook.save(temporary)
        os.replace(temporary, output)
    except Exception as exc:
        raise SkillError(
            "workbook_write_failed",
            "The workbook could not be written.",
            exit_code=EXIT_OUTPUT,
            details={"path": str(output), "reason": str(exc)},
        ) from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary and os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass


def path_result(path: Path, root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "path": str(path),
        "project_relative_path": path.relative_to(root).as_posix(),
    }
    if path.exists():
        result["size_bytes"] = path.stat().st_size
    return result
