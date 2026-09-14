"""Shared safety, JSON, asset, and output helpers for managed presentation modules."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import warnings
import zipfile
from pathlib import Path
from typing import Any, Callable


EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
EXIT_PRESENTATION = 4
EXIT_OUTPUT = 5
EXIT_VALIDATION = 6
EXIT_DEPENDENCY = 10
MAX_PPTX_BYTES = 256 * 1024 * 1024
MAX_SPEC_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_ZIP_ENTRIES = 10_000
MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024
MAX_ZIP_EXPANDED_BYTES = 512 * 1024 * 1024
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
DEFAULT_PROFILE = "liwa-modern"
SUPPORTED_PROFILES = {"liwa-modern", "academic-editorial", "digital-campus"}
DEFAULT_THEME = "modern-clean"
SUPPORTED_THEMES = {"modern-clean", "academic-editorial", "digital-tech", "warm-education", "ecnu-liwa"}
THEME_PROFILES = {
    "modern-clean": "liwa-modern",
    "academic-editorial": "academic-editorial",
    "digital-tech": "digital-campus",
    "warm-education": "academic-editorial",
    "ecnu-liwa": "liwa-modern",
}
PRESENTATION_MARKER = "ECNU-Agent-Presentations/v2"
PROFILE_KEYWORD_PREFIX = "profile="
THEME_KEYWORD_PREFIX = "theme="


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
    stream.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
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


def require_pptx() -> Any:
    try:
        import pptx
    except ImportError as exc:
        raise SkillError(
            "dependency_missing",
            "python-pptx is required in the managed Python environment.",
            exit_code=EXIT_DEPENDENCY,
            details={"package": "python-pptx", "recovery": "install python/requirements.txt into the interpreter configured by DSH_OFFICE_PYTHON"},
        ) from exc
    return pptx


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
    suffixes: tuple[str, ...] | None = None,
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
    if suffixes and resolved.suffix.lower() not in suffixes:
        raise SkillError(
            "invalid_file_type",
            f"{label} must use one of these extensions: {', '.join(suffixes)}.",
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
        size = resolved.stat().st_size
        limit = None
        if resolved.suffix.lower() == ".pptx":
            limit = MAX_PPTX_BYTES
        elif resolved.suffix.lower() == ".json":
            limit = MAX_SPEC_BYTES
        elif resolved.suffix.lower() in IMAGE_SUFFIXES:
            limit = MAX_IMAGE_BYTES
        if limit is not None and size > limit:
            raise SkillError(
                "file_too_large",
                f"{label} exceeds the managed file-size limit.",
                exit_code=EXIT_PRESENTATION,
                details={"path": str(resolved), "size_bytes": size, "max_bytes": limit},
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
        spec_path = project_path(
            file_path,
            root,
            label="--spec-file",
            must_exist=True,
            suffixes=(".json",),
        )
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


def asset_path(name: str) -> Path:
    script_dir = Path(__file__).resolve().parent
    candidates = (
        Path(os.environ.get("DSH_OFFICE_BRAND_ASSETS", str(script_dir / "assets"))) / name,
        script_dir / "assets" / name,
        script_dir.parent / "assets" / name,
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise SkillError(
        "brand_asset_missing",
        "A required ECNU brand asset is missing from the managed presentation package.",
        exit_code=EXIT_NOT_FOUND,
        details={"asset": name, "searched": [str(item) for item in candidates]},
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_save(presentation: Any, output: Path, *, overwrite: bool) -> None:
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
            suffix=".pptx",
            dir=str(output.parent),
        )
        os.close(descriptor)
        descriptor = -1
        presentation.save(temporary)
        if os.path.getsize(temporary) > MAX_PPTX_BYTES:
            raise SkillError(
                "file_too_large",
                "The generated PPTX exceeds the managed size limit.",
                exit_code=EXIT_OUTPUT,
                details={"size_bytes": os.path.getsize(temporary), "max_bytes": MAX_PPTX_BYTES},
            )
        os.replace(temporary, output)
    except SkillError:
        raise
    except Exception as exc:
        raise SkillError(
            "presentation_write_failed",
            "The presentation could not be written.",
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


def validate_ooxml_archive(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        raise SkillError("invalid_pptx_container", "The file is not a PPTX ZIP container.", exit_code=EXIT_PRESENTATION)
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise SkillError(
                    "archive_too_complex",
                    "The PPTX contains too many archive entries.",
                    exit_code=EXIT_PRESENTATION,
                    details={"entry_count": len(entries), "max_entries": MAX_ZIP_ENTRIES},
                )
            expanded = 0
            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise SkillError("encrypted_archive", "Encrypted PPTX parts are not supported.", exit_code=EXIT_PRESENTATION)
                if entry.file_size > MAX_ZIP_ENTRY_BYTES:
                    raise SkillError(
                        "archive_entry_too_large",
                        "A PPTX archive entry exceeds the managed expansion limit.",
                        exit_code=EXIT_PRESENTATION,
                        details={"entry": entry.filename, "size_bytes": entry.file_size, "max_bytes": MAX_ZIP_ENTRY_BYTES},
                    )
                expanded += entry.file_size
                if expanded > MAX_ZIP_EXPANDED_BYTES:
                    raise SkillError(
                        "archive_expansion_too_large",
                        "The PPTX expanded content exceeds the managed limit.",
                        exit_code=EXIT_PRESENTATION,
                        details={"expanded_bytes": expanded, "max_bytes": MAX_ZIP_EXPANDED_BYTES},
                    )
    except zipfile.BadZipFile as exc:
        raise SkillError("invalid_pptx_container", "The PPTX ZIP container is invalid.", exit_code=EXIT_PRESENTATION) from exc


def validate_image_file(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SkillError(
            "dependency_missing",
            "Pillow is required to validate presentation images.",
            exit_code=EXIT_DEPENDENCY,
            details={"package": "Pillow"},
        ) from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise SkillError(
                        "image_too_large",
                        "The image exceeds the managed pixel limit.",
                        exit_code=EXIT_PRESENTATION,
                        details={"width": width, "height": height, "max_pixels": MAX_IMAGE_PIXELS},
                    )
                image.verify()
                return width, height
    except SkillError:
        raise
    except Exception as exc:
        raise SkillError(
            "image_read_failed",
            "The image could not be safely decoded.",
            exit_code=EXIT_PRESENTATION,
            details={"path": str(path), "reason": str(exc)},
        ) from exc


def reject_unknown(mapping: dict[str, Any], allowed: set[str], *, label: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise SkillError(
            "unknown_fields",
            f"{label} contains unsupported fields.",
            details={"fields": unknown},
        )


def required_text(
    value: Any,
    *,
    label: str,
    maximum: int,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str):
        raise SkillError("invalid_text", f"{label} must be a string.")
    text = value.strip()
    if not text and not allow_empty:
        raise SkillError("invalid_text", f"{label} must not be empty.")
    if len(text) > maximum:
        raise SkillError(
            "text_too_long",
            f"{label} is too long for the fixed layout.",
            details={"length": len(text), "maximum": maximum},
        )
    return text


def optional_text(value: Any, *, label: str, maximum: int) -> str:
    if value is None:
        return ""
    return required_text(value, label=label, maximum=maximum, allow_empty=True)


def presentation_profile(value: Any) -> str:
    if value is None:
        return DEFAULT_PROFILE
    if not isinstance(value, str) or value not in SUPPORTED_PROFILES:
        raise SkillError(
            "unsupported_profile",
            "profile must be one of the fixed ECNU presentation profiles.",
            details={"profile": value, "supported": sorted(SUPPORTED_PROFILES)},
        )
    return value


def presentation_style(theme_value: Any, profile_value: Any) -> tuple[str, str, bool]:
    if theme_value is not None and profile_value is not None:
        raise SkillError("conflicting_style", "theme and legacy profile cannot be used together.")
    if profile_value is not None:
        return "", presentation_profile(profile_value), True
    theme = DEFAULT_THEME if theme_value is None else theme_value
    if not isinstance(theme, str) or theme not in SUPPORTED_THEMES:
        raise SkillError(
            "unsupported_theme",
            "theme must be one of the supported presentation themes.",
            details={"theme": theme_value, "supported": sorted(SUPPORTED_THEMES)},
        )
    return theme, THEME_PROFILES[theme], theme == "ecnu-liwa"


def profile_from_keywords(keywords: str) -> str:
    matches = [
        item.strip()[len(PROFILE_KEYWORD_PREFIX) :]
        for item in keywords.split(";")
        if item.strip().startswith(PROFILE_KEYWORD_PREFIX)
    ]
    if len(matches) != 1 or matches[0] not in SUPPORTED_PROFILES:
        return ""
    return matches[0]


def theme_from_keywords(keywords: str) -> str:
    matches = [
        item.strip()[len(THEME_KEYWORD_PREFIX) :]
        for item in keywords.split(";")
        if item.strip().startswith(THEME_KEYWORD_PREFIX)
    ]
    if len(matches) != 1 or matches[0] not in SUPPORTED_THEMES:
        return ""
    return matches[0]


def has_presentation_marker(keywords: str) -> bool:
    return PRESENTATION_MARKER in {item.strip() for item in keywords.split(";")}
