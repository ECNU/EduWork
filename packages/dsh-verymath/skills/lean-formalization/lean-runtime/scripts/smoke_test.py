from __future__ import annotations

from pathlib import Path
from typing import Any

from common import run_command
from configure_lean import inspect_environment
from tool_status import find_tool


SKILL_ROOT = Path(__file__).resolve().parents[1]
SMOKE_FILE = SKILL_ROOT / "examples" / "smoke" / "LocalLeanSmoke.lean"


def run_smoke_test(
    cwd: str | Path = ".",
    *,
    config_path: str | Path | None = None,
    timeout: int = 120,
    dry_run: bool = False,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    env = inspect_environment(cwd_path, config_path=config_path)
    lean = env.get("lean", {})
    workspace_root = lean.get("workspace_project_root") or lean.get("project_root")
    lake = find_tool("lake") or "lake"
    command = [lake, "env", "lean", str(SMOKE_FILE)]
    if dry_run:
        return {
            "ok": SMOKE_FILE.exists(),
            "status": "dry_run",
            "cwd": str(cwd_path),
            "project_root": str(workspace_root) if workspace_root else None,
            "smoke_file": str(SMOKE_FILE),
            "command": command,
            "missing_config": [] if workspace_root else ["lean_workspace"],
            "theorems": [
                "ai4math_local_smoke_add_zero",
                "ai4math_local_smoke_le_succ",
            ],
            "external_api_call": False,
            "recommended_next_action": "run the bundled smoke target, then start the coding-agent Lean task or discuss an adapter-first optional backend path",
        }
    if not workspace_root:
        return {
            "ok": False,
            "status": "missing_lean_workspace",
            "cwd": str(cwd_path),
            "smoke_file": str(SMOKE_FILE),
            "project_root": None,
            "environment": env,
            "recommended_next_action": "run configure --create-workspace, then rerun smoke-test",
        }

    result: dict[str, Any] = {
        "ok": True,
        "status": "ready",
        "cwd": str(cwd_path),
        "project_root": str(workspace_root),
        "smoke_file": str(SMOKE_FILE),
        "command": command,
        "theorems": [
            "ai4math_local_smoke_add_zero",
            "ai4math_local_smoke_le_succ",
        ],
        "external_api_call": False,
        "recommended_next_action": "use this verified workspace for the next coding-agent Lean task; call official Numina only if the optional backend path is approved",
    }
    lean_result = run_command(command, cwd=workspace_root, timeout=timeout)
    result["lean"] = lean_result
    result["ok"] = bool(lean_result.get("ok"))
    result["status"] = "ok" if result["ok"] else "lean_smoke_failed"
    if not result["ok"]:
        result["recommended_next_action"] = "inspect the Lean smoke error, then repair the shared workspace before any Lean task or optional backend call"
    return result
