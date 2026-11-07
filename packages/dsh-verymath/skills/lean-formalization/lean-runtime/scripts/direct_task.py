from __future__ import annotations

from pathlib import Path
from typing import Any

from check_lean_project import find_project_root, read_mathlib_revision, read_toolchain
from common import ai4math_home, expand_path, read_config


TASK_TO_PROMPT = {
    "prove": "prove_theorem.md",
    "formalize": "formalize_statement.md",
    "repair": "repair_lean_file.md",
    "complete-sorries": "complete_sorries.md",
    "batch": "prove_theorem.md",
}


def _managed_workspace_root(config: dict[str, Any], cwd_path: Path) -> tuple[Path | None, Path]:
    lean = config.get("lean", {})
    workspace_path = expand_path(lean.get("managed_workspace_path"), cwd_path) or (ai4math_home(cwd_path) / "lean-workspace")
    workspace_root = find_project_root(workspace_path) if workspace_path.exists() else None
    return workspace_root, workspace_path


def build_direct_task(
    task_type: str,
    cwd: str | Path,
    target: str | Path,
    max_rounds: int = 5,
    config_path: str | Path | None = None,
    prompt_file: str | Path | None = None,
    result_dir: str | Path | None = None,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    config = read_config(cwd_path, config_path)
    target_path = Path(target).expanduser().resolve()
    target_project_root = find_project_root(target_path)
    workspace_root, workspace_path = _managed_workspace_root(config, cwd_path)
    project_root = target_project_root or workspace_root
    workspace_mode = "target_project" if target_project_root else ("managed_workspace" if workspace_root else "missing")
    skill_root = Path(__file__).resolve().parents[1]
    prompt = Path(prompt_file).expanduser().resolve() if prompt_file else skill_root / "prompts" / TASK_TO_PROMPT.get(task_type, "prove_theorem.md")

    missing = []
    if project_root is None:
        missing.append("lean_workspace")
    if not target_path.exists() and task_type != "formalize":
        missing.append("target")

    next_actions = [
        "Read the target Lean file and identify the exact declaration or error.",
        "Run check or lake env lean after each small edit.",
        "Keep theorem statements unchanged unless the user explicitly approves a change.",
        "Stop when the file verifies without sorry/admit/axiom, or return minimize-failure output.",
    ]
    if task_type == "formalize":
        next_actions.insert(0, "Draft the Lean declaration from the source statement and ask for user confirmation before long proof work.")
    if task_type == "complete-sorries":
        next_actions.insert(0, "Locate each sorry/admit and solve one minimal target at a time.")

    return {
        "ok": not missing,
        "status": "coding_agent_task_ready" if not missing else "missing_config",
        "agent_mode": "coding-agent",
        "backend": "none",
        "task_type": task_type,
        "target": str(target_path),
        "cwd": str(cwd_path),
        "project_root": str(project_root) if project_root else None,
        "target_project_root": str(target_project_root) if target_project_root else None,
        "workspace_project_root": str(workspace_root) if workspace_root else None,
        "workspace_path": str(workspace_path),
        "workspace_mode": workspace_mode,
        "toolchain": read_toolchain(project_root),
        "mathlib_revision": read_mathlib_revision(project_root),
        "prompt_file": str(prompt),
        "result_dir": str(Path(result_dir).expanduser().resolve()) if result_dir else None,
        "max_rounds": max_rounds,
        "missing_config": missing,
        "required_inputs": ["existing Lake project or shared reusable managed workspace"] if "lean_workspace" in missing else [],
        "recommended_next_action": "run configure --create-workspace for the shared workspace or move target into a Lake project" if missing else "coding agent should edit/check directly; use a backend adapter only if the optional adapter path is approved",
        "direct_workflow": next_actions,
    }


def run_direct_task(
    task_type: str,
    cwd: str | Path,
    target: str | Path,
    max_rounds: int = 5,
    config_path: str | Path | None = None,
    prompt_file: str | Path | None = None,
    result_dir: str | Path | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    task = build_direct_task(task_type, cwd, target, max_rounds, config_path, prompt_file, result_dir)
    if dry_run and task.get("ok"):
        task["status"] = "dry_run"
    return task
