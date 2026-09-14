"""Shared validation, path isolation, and JSON helpers for managed PDF modules."""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable


EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
EXIT_PDF = 4
EXIT_OUTPUT = 5
EXIT_VALIDATION = 6
EXIT_DEPENDENCY = 10
MAX_PDF_BYTES = 512 * 1024 * 1024
MAX_PAGES = 5000


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


def emit(payload: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    stream.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    stream.flush()


def run(operation: str, function: Callable[[], int | None]) -> None:
    logging.getLogger("pypdf").setLevel(logging.ERROR)
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


def require_pypdf() -> Any:
    try:
        import pypdf
    except ImportError as exc:
        raise SkillError(
            "dependency_missing",
            "pypdf is required in the managed Python environment.",
            exit_code=EXIT_DEPENDENCY,
            details={"package": "pypdf"},
        ) from exc
    return pypdf


def require_reportlab() -> dict[str, Any]:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4, LETTER
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import (
            PageBreak,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError as exc:
        raise SkillError(
            "dependency_missing",
            "reportlab is required in the managed Python environment.",
            exit_code=EXIT_DEPENDENCY,
            details={"package": "reportlab"},
        ) from exc
    return {
        "colors": colors,
        "TA_CENTER": TA_CENTER,
        "TA_LEFT": TA_LEFT,
        "TA_RIGHT": TA_RIGHT,
        "A4": A4,
        "LETTER": LETTER,
        "ParagraphStyle": ParagraphStyle,
        "getSampleStyleSheet": getSampleStyleSheet,
        "mm": mm,
        "pdfmetrics": pdfmetrics,
        "UnicodeCIDFont": UnicodeCIDFont,
        "PageBreak": PageBreak,
        "Paragraph": Paragraph,
        "SimpleDocTemplate": SimpleDocTemplate,
        "Spacer": Spacer,
        "Table": Table,
        "TableStyle": TableStyle,
    }


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
        if resolved.stat().st_size > MAX_PDF_BYTES:
            raise SkillError(
                "file_too_large",
                f"{label} exceeds the managed PDF size limit.",
                exit_code=EXIT_PDF,
                details={"max_bytes": MAX_PDF_BYTES, "size_bytes": resolved.stat().st_size},
            )
    return resolved


def read_json_spec(
    *,
    inline: str | None,
    file_path: str | None,
    root: Path,
) -> dict[str, Any]:
    if bool(inline) == bool(file_path):
        raise SkillError("invalid_arguments", "Provide exactly one of --spec-json or --spec-file.")
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


def reject_unknown(mapping: dict[str, Any], allowed: set[str], *, label: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise SkillError(
            "unknown_fields",
            f"{label} contains unsupported fields.",
            details={"fields": unknown},
        )


def atomic_write(
    output: Path,
    write_function: Callable[[Path], None],
    *,
    overwrite: bool,
) -> None:
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
            suffix=".pdf",
            dir=str(output.parent),
        )
        os.close(descriptor)
        descriptor = -1
        write_function(Path(temporary))
        if not os.path.isfile(temporary) or os.path.getsize(temporary) == 0:
            raise OSError("The PDF writer produced an empty file.")
        if os.path.getsize(temporary) > MAX_PDF_BYTES:
            raise SkillError(
                "file_too_large",
                "The generated PDF exceeds the managed size limit.",
                exit_code=EXIT_OUTPUT,
                details={"max_bytes": MAX_PDF_BYTES, "size_bytes": os.path.getsize(temporary)},
            )
        os.replace(temporary, output)
    except SkillError:
        raise
    except Exception as exc:
        raise SkillError(
            "pdf_write_failed",
            "The PDF could not be written.",
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


def bounded_integer(raw: str, *, minimum: int, maximum: int, label: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise SkillError("invalid_arguments", f"{label} must be an integer.") from exc
    if not minimum <= value <= maximum:
        raise SkillError("invalid_arguments", f"{label} must be between {minimum} and {maximum}.")
    return value


def finite_number(value: Any, *, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SkillError("invalid_number", f"{label} must be a number.")
    converted = float(value)
    if not math.isfinite(converted) or not minimum <= converted <= maximum:
        raise SkillError(
            "invalid_number",
            f"{label} must be between {minimum} and {maximum}.",
        )
    return converted


def text_value(value: Any, *, label: str, required: bool = False, maximum: int = 20000) -> str:
    if not isinstance(value, str):
        raise SkillError("invalid_text", f"{label} must be a string.")
    result = value.strip() if required else value
    if required and not result:
        raise SkillError("invalid_text", f"{label} must not be empty.")
    if len(result) > maximum:
        raise SkillError("text_too_long", f"{label} exceeds {maximum} characters.")
    return result


PAGE_TOKEN = re.compile(r"^(\d+)(?:-(\d+))?$")


def parse_pages(raw: str, *, total_pages: int) -> list[int]:
    value = raw.strip().lower()
    if value == "all":
        return list(range(total_pages))
    if not value:
        raise SkillError("invalid_pages", "--pages must not be empty.")
    pages: list[int] = []
    seen: set[int] = set()
    for token in value.split(","):
        match = PAGE_TOKEN.fullmatch(token.strip())
        if not match:
            raise SkillError("invalid_pages", "--pages must use values such as 1,3-5 or all.")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < start or end > total_pages:
            raise SkillError(
                "page_out_of_range",
                "--pages contains an invalid or out-of-range page.",
                details={"token": token.strip(), "page_count": total_pages},
            )
        for number in range(start, end + 1):
            index = number - 1
            if index in seen:
                raise SkillError(
                    "duplicate_page",
                    "--pages must not contain duplicate pages.",
                    details={"page": number},
                )
            seen.add(index)
            pages.append(index)
    if pages != sorted(pages):
        raise SkillError("pages_not_ascending", "--pages must be in ascending order.")
    return pages


def reader_from(pypdf: Any, path: Path) -> Any:
    try:
        reader = pypdf.PdfReader(str(path), strict=False)
    except Exception as exc:
        raise SkillError(
            "pdf_read_failed",
            "The PDF could not be opened.",
            exit_code=EXIT_PDF,
            details={"path": str(path), "reason": str(exc)},
        ) from exc
    if reader.is_encrypted:
        raise SkillError(
            "encrypted_pdf_unsupported",
            "Encrypted PDFs are not supported by this managed skill.",
            exit_code=EXIT_PDF,
            details={"path": str(path)},
        )
    try:
        page_count = len(reader.pages)
    except Exception as exc:
        raise SkillError(
            "pdf_read_failed",
            "The PDF page tree could not be read.",
            exit_code=EXIT_PDF,
            details={"path": str(path), "reason": str(exc)},
        ) from exc
    if page_count > MAX_PAGES:
        raise SkillError(
            "too_many_pages",
            "The PDF exceeds the managed page limit.",
            exit_code=EXIT_PDF,
            details={"page_count": page_count, "max_pages": MAX_PAGES},
        )
    return reader


def copy_metadata(reader: Any, writer: Any) -> None:
    try:
        metadata = reader.metadata or {}
    except Exception:
        return
    clean: dict[str, str] = {}
    for key, value in metadata.items():
        if isinstance(key, str) and key.startswith("/") and value is not None:
            clean[key] = str(value)[:4096]
    if clean:
        writer.add_metadata(clean)
