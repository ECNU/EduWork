from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from common import run_command
from tool_status import find_tool


def has_lakefile(path: Path) -> bool:
    return (path / "lakefile.toml").exists() or (path / "lakefile.lean").exists()


def find_project_root(path: str | Path) -> Path | None:
    target = Path(path).expanduser().resolve()
    current = target.parent if target.is_file() else target
    while True:
        if (current / "lean-toolchain").exists() and has_lakefile(current):
            return current
        if current.parent == current:
            return None
        current = current.parent


def read_toolchain(root: Path | None) -> str | None:
    if not root:
        return None
    toolchain = root / "lean-toolchain"
    if not toolchain.exists():
        return None
    return toolchain.read_text(encoding="utf-8", errors="replace").strip() or None


def _search_manifest(value: Any) -> str | None:
    if isinstance(value, dict):
        name = value.get("name")
        if name == "mathlib":
            for key in ("rev", "revision", "inputRev", "gitRev"):
                found = value.get(key)
                if isinstance(found, str) and found:
                    return found
        for item in value.values():
            found = _search_manifest(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _search_manifest(item)
            if found:
                return found
    return None


def read_mathlib_revision(root: Path | None) -> str | None:
    if not root:
        return None
    manifest = root / "lake-manifest.json"
    if manifest.exists():
        try:
            return _search_manifest(json.loads(manifest.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            pass

    for lakefile in (root / "lakefile.toml", root / "lakefile.lean"):
        if not lakefile.exists():
            continue
        text = lakefile.read_text(encoding="utf-8", errors="replace")
        require_match = re.search(r'name\s*=\s*"mathlib".{0,400}?rev\s*=\s*"([^"]+)"', text, re.S)
        if require_match:
            return require_match.group(1)
        lean_match = re.search(r'require\s+mathlib\b.*?@\s*"?([A-Za-z0-9_.:/-]+)"?', text)
        if lean_match:
            return lean_match.group(1)
    return None


def check_project(cwd: str | Path = ".", skip_build: bool = False, file: str | Path | None = None, timeout: int = 300) -> dict[str, Any]:
    target = Path(file).expanduser().resolve() if file else Path(cwd).expanduser().resolve()
    root = find_project_root(target)
    result: dict[str, Any] = {
        "ok": root is not None,
        "status": "ok" if root else "missing_lean_project",
        "cwd": str(Path(cwd).expanduser().resolve()),
        "target": str(target),
        "project_root": str(root) if root else None,
        "toolchain": read_toolchain(root),
        "mathlib_revision": read_mathlib_revision(root),
        "has_lakefile": bool(root and has_lakefile(root)),
        "build": None,
        "errors": [],
    }
    if root is None:
        result["errors"].append({"severity": "error", "data": "No ancestor contains both lean-toolchain and lakefile.toml/lakefile.lean"})
        return result
    if skip_build:
        result["status"] = "ok_skip_build"
        return result
    lake = find_tool("lake") or "lake"
    build = run_command([lake, "build"], cwd=root, timeout=timeout)
    result["build"] = build
    result["ok"] = bool(build["ok"])
    result["status"] = "ok" if build["ok"] else "lean_build_failed"
    if not build["ok"]:
        result["errors"].append({"severity": "error", "data": build.get("stderr") or build.get("stdout") or "lake build failed"})
    return result


def check_file(file: str | Path, timeout: int = 300) -> dict[str, Any]:
    file_path = Path(file).expanduser().resolve()
    root = find_project_root(file_path)
    if root is None:
        return {
            "ok": False,
            "status": "missing_lean_project",
            "file": str(file_path),
            "project_root": None,
            "toolchain": None,
            "mathlib_revision": None,
            "errors": [{"severity": "error", "data": "File is not inside a Lake project"}],
        }
    lake = find_tool("lake") or "lake"
    run = run_command([lake, "env", "lean", str(file_path)], cwd=root, timeout=timeout)
    return {
        "ok": bool(run["ok"]),
        "status": "ok" if run["ok"] else "lean_file_failed",
        "file": str(file_path),
        "project_root": str(root),
        "toolchain": read_toolchain(root),
        "mathlib_revision": read_mathlib_revision(root),
        "lean": run,
        "errors": [] if run["ok"] else [{"severity": "error", "data": run.get("stderr") or run.get("stdout") or "lean check failed"}],
    }
