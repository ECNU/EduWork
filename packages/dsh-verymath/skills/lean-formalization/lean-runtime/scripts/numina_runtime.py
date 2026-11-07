from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Any

from common import ENV_KEY_RE, ai4math_home, ensure_ai4math_gitignore, expand_path, run_command
from tool_status import tool_versions


DEFAULT_UPSTREAM_URL = "https://github.com/project-numina/numina-lean-agent"
DEFAULT_PROMPT_FILE = "prompts/autosearch/main_entry.md"
CLAUDE_ENV_KEYS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]
SKILL_ENV_KEYS = ["GEMINI_API_KEY", "OPENAI_API_KEY", "LEAN_LEANDEX_API_KEY", "AXLE_API_KEY"]


def runtime_root(cwd: str | Path) -> Path:
    cwd_path = Path(cwd).resolve()
    override = os.environ.get("AI4MATH_NUMINA_HOME")
    if override:
        return expand_path(override, cwd_path) or (ai4math_home(cwd_path) / "numina-runtime")
    return ai4math_home(cwd_path) / "numina-runtime"


def runtime_paths(cwd: str | Path) -> dict[str, str]:
    root = runtime_root(cwd)
    return {
        "root": str(root),
        "upstream": str(root / "upstream"),
        "projects": str(root / "upstream" / "projects"),
        "results": str(root / "results"),
        "env_local": str(root / ".env.local"),
        "local_config": str(root / "numina_runtime.local.toml"),
        "default_upstream_url": DEFAULT_UPSTREAM_URL,
    }


def upstream_url() -> str:
    return os.environ.get("AI4MATH_NUMINA_UPSTREAM_URL") or DEFAULT_UPSTREAM_URL


def upstream_ref() -> str | None:
    return os.environ.get("AI4MATH_NUMINA_UPSTREAM_REF") or None


def _parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            parts = shlex.split(line, comments=True, posix=True)
        except ValueError:
            continue
        if parts and parts[0] == "export":
            parts = parts[1:]
        for part in parts:
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            if ENV_KEY_RE.match(key):
                values[key] = value
    return values


def read_numina_env_local(cwd: str | Path) -> dict[str, str]:
    return _parse_env_file(runtime_root(cwd) / ".env.local")


def _redact(value: str | None) -> str | None:
    return "<redacted>" if value else None


def credential_report(env: dict[str, str] | None = None) -> dict[str, Any]:
    merged = dict(os.environ)
    if env:
        merged.update(env)
    claude_variables = {key: _redact(merged.get(key)) for key in CLAUDE_ENV_KEYS}
    skill_keys = {key: _redact(merged.get(key)) for key in SKILL_ENV_KEYS}
    return {
        "claude": {
            "configured": bool(merged.get("ANTHROPIC_AUTH_TOKEN")),
            "variables": claude_variables,
        },
        "skill_keys": skill_keys,
        "missing_skill_keys": [key for key in SKILL_ENV_KEYS if not merged.get(key)],
    }


def _action(name: str, command: list[str], cwd: str | Path, *, dry_run: bool = False, timeout: int = 300) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": name,
        "command": command,
        "cwd": str(Path(cwd).resolve()),
        "timeout": timeout,
    }
    if dry_run:
        item["skipped"] = True
        item["reason"] = "dry_run"
    return item


def inspect_upstream(cwd: str | Path) -> dict[str, Any]:
    upstream = runtime_root(cwd) / "upstream"
    if not upstream.exists():
        return {
            "exists": False,
            "installed": False,
            "path": str(upstream),
            "status": "missing",
            "remote": None,
            "head": None,
            "dirty": False,
        }
    if not (upstream / ".git").exists():
        return {
            "exists": True,
            "installed": False,
            "path": str(upstream),
            "status": "path_exists_non_git",
            "remote": None,
            "head": None,
            "dirty": None,
        }
    remote = run_command(["git", "remote", "get-url", "origin"], cwd=upstream)
    head = run_command(["git", "rev-parse", "HEAD"], cwd=upstream)
    dirty = run_command(["git", "status", "--short"], cwd=upstream)
    dirty_stdout = (dirty.get("stdout") or "").strip()
    return {
        "exists": True,
        "installed": True,
        "path": str(upstream),
        "status": "installed",
        "remote": (remote.get("stdout") or "").strip() if remote.get("ok") else None,
        "head": (head.get("stdout") or "").strip() if head.get("ok") else None,
        "dirty": bool(dirty_stdout),
        "dirty_status": dirty_stdout.splitlines()[:20],
        "dirty_check_ok": bool(dirty.get("ok")),
    }


def build_install_plan(cwd: str | Path, *, dry_run: bool = False) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    root = runtime_root(cwd_path)
    upstream = root / "upstream"
    ref = upstream_ref()
    actions: list[dict[str, Any]] = []

    if upstream.exists() and not (upstream / ".git").exists():
        return {
            "ok": False,
            "status": "upstream_path_exists_non_git",
            "paths": runtime_paths(cwd_path),
            "actions": [],
            "recommended_next_action": f"move or remove {upstream} before setup",
        }

    if not upstream.exists():
        actions.append(_action(
            "clone_numina_upstream",
            ["git", "clone", upstream_url(), str(upstream)],
            cwd_path,
            dry_run=dry_run,
            timeout=1800,
        ))
    else:
        upstream_info = inspect_upstream(cwd_path)
        if not upstream_info.get("dirty_check_ok", True):
            return {
                "ok": False,
                "status": "upstream_status_failed",
                "paths": runtime_paths(cwd_path),
                "upstream": upstream_info,
                "actions": [],
                "recommended_next_action": "inspect the Numina upstream checkout before setup",
            }
        if upstream_info.get("dirty"):
            return {
                "ok": False,
                "status": "dirty_upstream",
                "paths": runtime_paths(cwd_path),
                "upstream": upstream_info,
                "actions": [],
                "recommended_next_action": "review or commit local changes under the Numina upstream checkout before setup",
            }
        actions.append(_action(
            "fetch_numina_upstream",
            ["git", "fetch", "--all", "--prune"],
            upstream,
            dry_run=dry_run,
            timeout=900,
        ))

    if ref:
        actions.append(_action(
            "checkout_numina_ref",
            ["git", "checkout", ref],
            upstream,
            dry_run=dry_run,
        ))

    return {
        "ok": True,
        "status": "install_plan_ready",
        "paths": runtime_paths(cwd_path),
        "upstream_ref": ref,
        "actions": actions,
        "recommended_next_action": "review actions, then run configure --setup-numina --project-name <name>",
    }


def build_configure_plan(
    cwd: str | Path,
    *,
    project_name: str | None,
    dry_run: bool = False,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    if not project_name:
        return {
            "ok": False,
            "status": "missing_project_name",
            "paths": runtime_paths(cwd_path),
            "actions": [],
            "recommended_next_action": "rerun configure --setup-numina with --project-name <name>",
        }

    install = build_install_plan(cwd_path, dry_run=dry_run)
    if not install.get("ok"):
        return {
            "ok": False,
            "status": install.get("status", "install_plan_failed"),
            "paths": runtime_paths(cwd_path),
            "install": install,
            "actions": [],
            "recommended_next_action": install.get("recommended_next_action"),
        }

    upstream = runtime_root(cwd_path) / "upstream"
    actions = list(install.get("actions", []))
    actions.extend([
        _action(
            "setup_numina_project",
            ["./setup.sh", project_name],
            upstream / "tutorial",
            dry_run=dry_run,
            timeout=3600,
        ),
        _action(
            "uv_python_install",
            ["uv", "python", "install"],
            upstream,
            dry_run=dry_run,
            timeout=1800,
        ),
        _action(
            "uv_sync",
            ["uv", "sync"],
            upstream,
            dry_run=dry_run,
            timeout=1800,
        ),
    ])

    return {
        "ok": True,
        "status": "dry_run" if dry_run else "configure_plan_ready",
        "paths": runtime_paths(cwd_path),
        "project_name": project_name,
        "install": install,
        "actions": actions,
        "recommended_next_action": "run official Numina on a buildable Lean project, then validate locally with check/review",
    }


def execute_configure_plan(
    cwd: str | Path,
    *,
    project_name: str | None,
    dry_run: bool = False,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    plan = build_configure_plan(cwd_path, project_name=project_name, dry_run=dry_run)
    if dry_run or not plan.get("ok"):
        return plan

    ensure_ai4math_gitignore(cwd_path)
    runtime_root(cwd_path).mkdir(parents=True, exist_ok=True)
    env = read_numina_env_local(cwd_path)
    executed: list[dict[str, Any]] = []
    ok = True
    for action in plan.get("actions", []):
        result = run_command(
            action["command"],
            cwd=action.get("cwd"),
            timeout=int(action.get("timeout", 300)),
            env=env if env else None,
        )
        executed_action = dict(action)
        executed_action.update({
            "ok": result.get("ok"),
            "returncode": result.get("returncode"),
            "stdout": result.get("stdout"),
            "stderr": result.get("stderr"),
        })
        executed.append(executed_action)
        if not result.get("ok"):
            ok = False
            break

    plan["actions"] = executed
    plan["ok"] = ok
    plan["status"] = "configured" if ok else "numina_setup_failed"
    if not ok:
        plan["recommended_next_action"] = "inspect the failed setup action, then rerun configure --setup-numina after fixing the local environment"
    return plan


def build_run_plan(
    cwd: str | Path,
    *,
    file: str | Path,
    mode: str = "from-folder",
    prompt_file: str = DEFAULT_PROMPT_FILE,
    result_dir: str | Path | None = None,
    max_iters: int = 10,
    reference_resources: str | None = None,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    target = expand_path(str(file), cwd_path) or Path(file).expanduser().resolve()
    upstream = runtime_root(cwd_path) / "upstream"
    if mode not in {"run", "batch", "from-folder"}:
        return {
            "ok": False,
            "status": "unsupported_numina_mode",
            "mode": mode,
            "supported_modes": ["run", "batch", "from-folder"],
        }
    result_path = expand_path(str(result_dir), cwd_path) if result_dir else runtime_root(cwd_path) / "results" / "manual"
    command = [
        "uv",
        "run",
        "python",
        "-m",
        "scripts.run_claude",
        mode,
        str(target),
        "--prompt-file",
        prompt_file,
        "--max-rounds",
        str(max_iters),
        "--result-dir",
        str(result_path),
    ]
    env = {}
    if reference_resources:
        env["REFERENCE_RESOURCES"] = reference_resources
    return {
        "ok": True,
        "status": "run_plan_ready",
        "cwd": str(upstream),
        "mode": mode,
        "command": command,
        "env": env,
        "target": str(target),
        "result_dir": str(result_path),
        "recommended_next_action": "explain the run to the user, execute only after approval, then validate the resulting Lean patch locally",
    }


def build_batch_plan(cwd: str | Path, *, folder: str | Path, **kwargs: Any) -> dict[str, Any]:
    return build_run_plan(cwd, file=folder, mode="from-folder", **kwargs)


def numina_readiness(cwd: str | Path, target: str | Path | None = None) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    env_local = read_numina_env_local(cwd_path)
    credentials = credential_report(env_local)
    tools = tool_versions(["git", "curl", "uv", "claude"])
    missing_tools = [name for name, info in tools.items() if not info.get("available")]
    upstream = inspect_upstream(cwd_path)
    missing: list[str] = []
    if missing_tools:
        missing.append("tools")
    if not upstream.get("installed"):
        missing.append("upstream")
    can_call_claude = bool(tools.get("claude", {}).get("available")) or credentials["claude"]["configured"]
    if not can_call_claude:
        missing.append("claude_cli_or_auth")

    result: dict[str, Any] = {
        "ok": not missing,
        "status": "ready" if not missing else "needs_setup",
        "paths": runtime_paths(cwd_path),
        "tools": tools,
        "missing_tools": missing_tools,
        "credentials": credentials,
        "upstream": upstream,
        "missing": missing,
        "readiness": {
            "can_clone_upstream": bool(tools.get("git", {}).get("available")),
            "can_run_setup": all(tools.get(name, {}).get("available") for name in ("git", "curl")),
            "can_sync_python": bool(tools.get("uv", {}).get("available")),
            "can_call_claude_cli": can_call_claude,
        },
        "recommended_next_action": "run configure --setup-numina --project-name <name>" if missing else "ready to discuss an official Numina run",
    }
    if target:
        result["target"] = str(Path(target).expanduser().resolve())
    return result
