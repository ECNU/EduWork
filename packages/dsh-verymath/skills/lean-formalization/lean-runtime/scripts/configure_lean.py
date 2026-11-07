from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from check_lean_project import find_project_root, read_mathlib_revision, read_toolchain
from common import CANONICAL_LEAN_TOOLCHAIN, ai4math_home, ensure_ai4math_gitignore, expand_path, read_config, run_command, update_local_toml
from numina_runtime import execute_configure_plan, numina_readiness
from tool_status import find_tool


def _safe_lake_name(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in name).strip("_")
    if not cleaned:
        return "lean_workspace"
    if cleaned[0].isdigit():
        cleaned = f"lean_{cleaned}"
    return cleaned


def _lake_command(lake: str, toolchain: str | None, args: list[str]) -> list[str]:
    if toolchain and toolchain != "auto":
        return [find_tool("elan") or "elan", "run", toolchain, "lake", *args]
    return [lake, *args]


def _workspace_setup_commands(lake: str, toolchain: str | None, workspace: Path) -> list[list[str]]:
    commands: list[list[str]] = []
    if not (workspace / "lake-manifest.json").exists():
        commands.append(_lake_command(lake, toolchain, ["update"]))
    commands.extend([
        _lake_command(lake, toolchain, ["exe", "cache", "get"]),
        _lake_command(lake, toolchain, ["build"]),
    ])
    return commands


def _effective_managed_toolchain(config: dict[str, Any], requested_toolchain: str | None) -> str:
    if requested_toolchain is not None:
        return requested_toolchain.strip() or CANONICAL_LEAN_TOOLCHAIN
    configured = str(config.get("lean", {}).get("preferred_toolchain") or "").strip()
    if configured and configured != "auto":
        return configured
    return CANONICAL_LEAN_TOOLCHAIN


def _workspace_needs_setup(workspace: Path) -> bool:
    return not ((workspace / "lake-manifest.json").exists() and (workspace / ".lake").exists())


def _action_failed(action: dict[str, Any]) -> bool:
    return not action.get("skipped") and not action.get("recoverable") and not action.get("ok", False)


def _workspace_info(path: Path) -> dict[str, Any]:
    root = find_project_root(path)
    return {
        "path": str(path),
        "exists": path.exists(),
        "project_root": str(root) if root else None,
        "toolchain": read_toolchain(root),
        "mathlib_revision": read_mathlib_revision(root),
    }


def inspect_environment(cwd: str | Path = ".", config_path: str | Path | None = None, target: str | Path | None = None) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    config = read_config(cwd_path, config_path)
    lean = config.get("lean", {})
    target_path = Path(target).expanduser().resolve() if target else cwd_path
    project_root = find_project_root(target_path)
    workspace_path = expand_path(lean.get("managed_workspace_path"), cwd_path) or (ai4math_home(cwd_path) / "lean-workspace")
    workspace_root = find_project_root(workspace_path) if workspace_path.exists() else None

    missing: list[str] = []
    required_inputs: list[str] = []
    if project_root is None and workspace_root is None:
        missing.append("lean_workspace")
        required_inputs.append("existing Lake project or permission to create/reuse the shared Lean workspace")

    return {
        "ok": not missing,
        "status": "configured" if not missing else "missing_config",
        "configuration_status": "configured" if not missing else "missing_config",
        "cwd": str(cwd_path),
        "agent": {
            "mode": "coding-agent",
            "backend": "none",
            "numina_required": False,
            "numina_runtime": "built_in_recipe",
        },
        "lean": {
            "target": str(target_path),
            "project_root": str(project_root) if project_root else None,
            "toolchain": read_toolchain(project_root),
            "mathlib_revision": read_mathlib_revision(project_root),
            "workspace_path": str(workspace_path),
            "workspace_project_root": str(workspace_root) if workspace_root else None,
            "workspace_toolchain": read_toolchain(workspace_root),
            "workspace_mathlib_revision": read_mathlib_revision(workspace_root),
            "workspace_mode": lean.get("workspace_mode", "reuse-managed"),
            "align_workspace_versions": bool(lean.get("align_workspace_versions", True)),
        },
        "numina": numina_readiness(cwd_path, target=target_path),
        "missing_config": missing,
        "required_inputs": required_inputs,
        "recommended_next_action": "run configure --create-workspace or provide a Lake project" if missing else "ready",
    }


def configure(
    cwd: str | Path = ".",
    config_path: str | Path | None = None,
    target: str | Path | None = None,
    create_workspace: bool = False,
    toolchain: str | None = None,
    save_local: bool = False,
    dry_run: bool = False,
    setup_numina: bool = False,
    project_name: str | None = None,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    if not dry_run:
        ensure_ai4math_gitignore(cwd_path)

    config = read_config(cwd_path, config_path)
    lean = config.get("lean", {})
    effective_toolchain = _effective_managed_toolchain(config, toolchain)
    workspace = expand_path(lean.get("managed_workspace_path"), cwd_path) or (ai4math_home(cwd_path) / "lean-workspace")
    workspace_root_config = expand_path(lean.get("managed_workspace_root"), cwd_path) or (workspace.parent / "lean-workspaces")
    workspace_actions: list[dict[str, Any]] = []
    if create_workspace:
        lake = find_tool("lake") or "lake"
        parent = workspace.parent
        lake_project_name = _safe_lake_name(workspace.name)
        created_path = parent / lake_project_name
        if dry_run:
            workspace_actions.append({
                "command": _lake_command(lake, effective_toolchain, ["new", lake_project_name, "math"]),
                "cwd": str(parent),
                "skipped": True,
                "reason": "dry_run",
            })
        elif not workspace.exists():
            parent.mkdir(parents=True, exist_ok=True)
            created = run_command(_lake_command(lake, effective_toolchain, ["new", lake_project_name, "math"]), cwd=parent)
            if not created.get("ok") and find_project_root(created_path):
                created["recoverable"] = True
                created["recovered_by"] = "lake_project_files_created"
            workspace_actions.append(created)
            if created.get("ok") or created.get("recoverable"):
                if created_path != workspace:
                    shutil.move(str(created_path), str(workspace))
                    workspace_actions.append({
                        "ok": True,
                        "command": ["move", str(created_path), str(workspace)],
                        "returncode": 0,
                        "stdout": "",
                        "stderr": "",
                    })
        elif find_project_root(workspace):
            workspace_actions.append({
                "ok": True,
                "command": ["reuse", str(workspace)],
                "returncode": 0,
                "stdout": "",
                "stderr": "",
            })
        if not dry_run and find_project_root(workspace) and _workspace_needs_setup(workspace):
            for command in _workspace_setup_commands(lake, effective_toolchain, workspace):
                workspace_actions.append(run_command(command, cwd=workspace, timeout=1800))

    workspace_info = _workspace_info(workspace)
    workspace_failed = create_workspace and not dry_run and (
        not workspace_info["project_root"] or any(_action_failed(action) for action in workspace_actions)
    )
    if (save_local or create_workspace) and not dry_run:
        update_local_toml(cwd_path, {
            "lean": {
                "workspace_mode": "reuse-managed",
                "managed_workspace_path": str(workspace),
                "managed_workspace_root": str(workspace_root_config),
                "reuse_managed_workspace": True,
                "workspace_key": "lean-toolchain",
                "align_workspace_versions": True,
                "preferred_toolchain": effective_toolchain,
                "preferred_mathlib_rev": "auto",
                "allow_user_project_version_changes": False,
            },
            "agent": {
                "mode": "coding-agent",
                "backend": "none",
            },
        })

    env = inspect_environment(cwd_path, config_path=config_path, target=target)
    env["workspace"] = workspace_info
    env["workspace_actions"] = workspace_actions
    if setup_numina:
        numina_result = execute_configure_plan(
            cwd_path,
            project_name=project_name,
            dry_run=dry_run,
        )
        env["numina"] = numina_result
        if numina_result.get("ok"):
            env["ok"] = True
            env["status"] = numina_result.get("status", "numina_configured")
            env["configuration_status"] = "numina_runtime_ready" if not dry_run else "numina_runtime_dry_run"
            env["recommended_next_action"] = numina_result.get("recommended_next_action", "ready")
        else:
            env["ok"] = False
            env["status"] = "interactive_required" if numina_result.get("status") == "missing_project_name" else numina_result.get("status", "numina_setup_failed")
            env["configuration_status"] = "numina_runtime_missing_config"
            env["recommended_next_action"] = numina_result.get("recommended_next_action", "review Numina setup requirements")
    if workspace_failed:
        env["ok"] = False
        env["status"] = "lean_workspace_setup_failed"
        env["configuration_status"] = "missing_config"
        env["recommended_next_action"] = "retry configure --create-workspace after Lean/mathlib download succeeds"
    return env
