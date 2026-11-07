from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ModuleNotFoundError:
        tomllib = None  # type: ignore[assignment]


SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SKILL_ROOT / "config" / "lean_agent.example.toml"
ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CANONICAL_LEAN_TOOLCHAIN = "leanprover/lean4:v4.28.0"


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _parse_simple_value(raw: str) -> Any:
    value = raw.strip().rstrip(",")
    if value in {"true", "false"}:
        return value == "true"
    if value.startswith('"') and value.endswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
    try:
        return int(value)
    except ValueError:
        return value


def _load_simple_toml(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    section: dict[str, Any] = data
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section_name = line[1:-1].strip()
            section = data.setdefault(section_name, {})
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        section[key.strip()] = _parse_simple_value(value)
    return data


def load_toml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    if tomllib is None:
        return _load_simple_toml(path)
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    return data if isinstance(data, dict) else {}


def expand_path(value: str | None, cwd: Path) -> Path | None:
    if not value:
        return None
    expanded = os.path.expandvars(os.path.expanduser(value))
    path = Path(expanded)
    if not path.is_absolute():
        path = cwd / path
    return Path(os.path.abspath(path))


def ai4math_home(cwd: str | Path = ".") -> Path:
    cwd_path = Path(cwd).resolve()
    override = os.environ.get("AI4MATH_HOME")
    if override:
        return expand_path(override, cwd_path) or (Path.home() / ".ai4math")
    return Path.home() / ".ai4math"


def read_config(cwd: str | Path = ".", config_path: str | Path | None = None) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    config = load_toml(DEFAULT_CONFIG)
    if config_path:
        config = deep_merge(config, load_toml(Path(config_path).expanduser()))
    local_config = cwd_path / ".ai4math" / "lean_agent.local.toml"
    config = deep_merge(config, load_toml(local_config))

    home = ai4math_home(cwd_path)
    env_values = {
        "managed_workspace_path": os.environ.get("AI4MATH_LEAN_WORKSPACE"),
        "preferred_toolchain": os.environ.get("AI4MATH_LEAN_TOOLCHAIN"),
    }
    if os.environ.get("AI4MATH_HOME") and not env_values["managed_workspace_path"]:
        env_values["managed_workspace_path"] = str(home / "lean-workspace")
        env_values["managed_workspace_root"] = str(home / "lean-workspaces")
    env_lean = {key: value for key, value in env_values.items() if value}
    if env_lean:
        config = deep_merge(config, {"lean": env_lean})
    return config


def ensure_ai4math_gitignore(cwd: str | Path) -> Path:
    ai4math = Path(cwd).resolve() / ".ai4math"
    ai4math.mkdir(parents=True, exist_ok=True)
    gitignore = ai4math / ".gitignore"
    entries = [
        "lean_agent.local.toml",
        ".env.local",
        "lean-workspace/",
        "lean-workspaces/",
        "numina-runtime/",
        "logs/",
        "failures/",
    ]
    current = gitignore.read_text(encoding="utf-8").splitlines() if gitignore.exists() else []
    merged = list(current)
    for entry in entries:
        if entry not in merged:
            merged.append(entry)
    gitignore.write_text("\n".join(merged).rstrip() + "\n", encoding="utf-8")
    return gitignore


def write_local_toml(cwd: str | Path, values: dict[str, dict[str, Any]]) -> Path:
    ensure_ai4math_gitignore(cwd)
    path = Path(cwd).resolve() / ".ai4math" / "lean_agent.local.toml"
    lines: list[str] = []
    for section, items in values.items():
        lines.append(f"[{section}]")
        for key, value in items.items():
            if isinstance(value, bool):
                rendered = "true" if value else "false"
            elif isinstance(value, (int, float)):
                rendered = str(value)
            else:
                rendered = json.dumps(str(value))
            lines.append(f"{key} = {rendered}")
        lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path


def update_local_toml(cwd: str | Path, values: dict[str, dict[str, Any]]) -> Path:
    local_config = Path(cwd).resolve() / ".ai4math" / "lean_agent.local.toml"
    merged = deep_merge(load_toml(local_config), values)
    return write_local_toml(cwd, merged)


def read_env_local(cwd: str | Path) -> dict[str, str]:
    path = Path(cwd).resolve() / ".ai4math" / ".env.local"
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


def write_env_local(cwd: str | Path, values: dict[str, str]) -> Path:
    ensure_ai4math_gitignore(cwd)
    path = Path(cwd).resolve() / ".ai4math" / ".env.local"
    invalid = [key for key in values if not ENV_KEY_RE.match(key)]
    if invalid:
        raise ValueError(f"Invalid environment variable name(s): {', '.join(invalid)}")

    current = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    keys = set(values)
    kept: list[str] = []
    for raw_line in current:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            kept.append(raw_line)
            continue
        try:
            parts = shlex.split(stripped, comments=True, posix=True)
        except ValueError:
            kept.append(raw_line)
            continue
        if parts and parts[0] == "export":
            parts = parts[1:]
        assigned_keys = {part.split("=", 1)[0] for part in parts if "=" in part}
        if assigned_keys & keys:
            continue
        kept.append(raw_line)

    if kept and kept[-1].strip():
        kept.append("")
    for key, value in values.items():
        kept.append(f"export {key}={shlex.quote(str(value))}")
    path.write_text("\n".join(kept).rstrip() + "\n", encoding="utf-8")
    return path


def run_command(
    command: list[str],
    cwd: str | Path | None = None,
    timeout: int = 300,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    def to_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    try:
        command_env = None
        if env is not None:
            command_env = os.environ.copy()
            command_env.update(env)
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=command_env,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        return {
            "ok": False,
            "returncode": 127,
            "stdout": "",
            "stderr": str(exc),
            "command": command,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": 124,
            "stdout": to_text(exc.stdout),
            "stderr": to_text(exc.stderr) or f"Timed out after {timeout}s",
            "command": command,
        }
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": to_text(completed.stdout),
        "stderr": to_text(completed.stderr),
        "command": command,
    }


def emit_json(result: dict[str, Any], json_output: str | None = None) -> None:
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if json_output:
        Path(json_output).expanduser().write_text(payload + "\n", encoding="utf-8")
    print(payload)


def exit_with(result: dict[str, Any], json_output: str | None = None, code: int | None = None) -> None:
    emit_json(result, json_output=json_output)
    if code is None:
        code = 0 if result.get("ok") else 1
    sys.exit(code)


def rel_or_abs(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)
