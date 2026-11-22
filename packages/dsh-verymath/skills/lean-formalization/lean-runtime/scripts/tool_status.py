from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from common import run_command


DEFAULT_TOOLS = ["git", "python3", "elan", "lean", "lake", "curl", "uv", "claude"]
EXTRA_BIN_DIRS = [
    Path.home() / ".elan" / "bin",
    Path.home() / ".local" / "bin",
    Path.home() / ".cargo" / "bin",
]


def find_tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for directory in EXTRA_BIN_DIRS:
        candidate = directory / name
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    return None


def tool_versions(names: list[str] | None = None) -> dict[str, Any]:
    tools: dict[str, Any] = {}
    for name in names or DEFAULT_TOOLS:
        path = find_tool(name)
        info: dict[str, Any] = {"path": path, "available": bool(path)}
        if path:
            if name in {"lean", "lake"} and ".elan/bin" in path:
                info["version_ok"] = None
                info["version"] = []
                info["version_note"] = "skipped to avoid implicit elan toolchain download"
                tools[name] = info
                continue
            version = run_command([path, "--version"], timeout=20)
            info["version_ok"] = bool(version.get("ok"))
            info["version"] = (version.get("stdout") or version.get("stderr") or "").strip().splitlines()[:3]
        tools[name] = info
    return tools


def doctor(cwd: str | Path = ".") -> dict[str, Any]:
    tools = tool_versions()
    missing = [name for name, info in tools.items() if not info["available"]]
    missing_for_lean_workspace = [name for name in ("lake",) if not tools[name]["available"]]
    missing_for_clone = [name for name in ("git",) if not tools[name]["available"]]
    return {
        "ok": True,
        "status": "reported",
        "cwd": str(Path(cwd).resolve()),
        "tools": tools,
        "missing_tools": missing,
        "readiness": {
            "can_create_lean_workspace": not missing_for_lean_workspace,
            "missing_for_lean_workspace": missing_for_lean_workspace,
            "missing_for_clone": missing_for_clone,
        },
        "recommended_next_action": _recommend(
            missing_for_clone,
            missing_for_lean_workspace,
        ),
    }


def _recommend(
    missing_clone: list[str],
    missing_lean: list[str],
) -> str:
    if missing_clone:
        return "install git before using Lake projects with remote dependencies"
    if missing_lean:
        return "install Lean/elan before creating the reusable Lean workspace"
    return "ready for coding-agent Lean workflow and adapter-first optional backend orchestration"
