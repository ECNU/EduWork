from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from check_lean_project import check_project
from common import run_command
from configure_lean import inspect_environment
from direct_task import run_direct_task
from extract_minimal_failure import extract
from smoke_test import run_smoke_test
from tool_status import doctor, find_tool
from validate_patch import review_files


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = RUNTIME_ROOT.parent
FORMALIZATION_ROOT = SKILLS_ROOT / "lean-formalization"
SETUP_ROOT = SKILLS_ROOT / "lean-setup"
REQUIRED_FORMALIZATION_FILES = [
    "SKILL.md",
    "agents/openai.yaml",
]
REQUIRED_RUNTIME_FILES = [
    "config/lean_agent.example.toml",
    "config/numina_runtime.example.toml",
    "examples/smoke/LocalLeanSmoke.lean",
    "schemas/task.schema.json",
    "schemas/result.schema.json",
    "schemas/config.schema.json",
    "references/lean_runtime_configuration.md",
    "references/backend_adapter_checklist.md",
    "references/interactive_orchestration.md",
    "references/direct_lean_workflow.md",
    "references/specialist_agent_patterns.md",
    "references/lean_agent_capability_map.md",
    "references/lean_lsp_mcp_adapter.md",
    "references/numina_runtime.md",
    "references/numina_subagent_troubleshooting.md",
    "references/review_checklist.md",
    "references/failure_taxonomy.md",
    "references/numina_reverse_analysis.md",
    "scripts/ai4m_lean.py",
    "scripts/configure_lean.py",
    "scripts/direct_task.py",
    "scripts/numina_runtime.py",
    "scripts/smoke_test.py",
    "scripts/validate_patch.py",
    "scripts/extract_minimal_failure.py",
]
REQUIRED_COMMANDS = {
    "env",
    "doctor",
    "configure",
    "check",
    "prove",
    "formalize",
    "repair",
    "complete-sorries",
    "batch",
    "review",
    "detect-sorry",
    "minimize-failure",
    "smoke-test",
    "verify-delivery",
}


def _parser_commands() -> set[str]:
    from ai4m_lean import build_parser

    parser = build_parser()
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return set(action.choices)
    return set()


def _load_schema(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _package_hygiene() -> dict[str, Any]:
    package_roots = [RUNTIME_ROOT]
    for root in (FORMALIZATION_ROOT, SETUP_ROOT):
        if root.exists():
            package_roots.append(root)
    generated = [
        str(path.relative_to(SKILLS_ROOT))
        for root in package_roots
        for path in root.rglob("*")
        if "__pycache__" in path.parts or path.suffix == ".pyc"
    ]
    suspicious_secret_patterns = [
        "sk-" + "ant-",
        "sk-" + "proj-",
        "BEGIN " + "OPENAI API KEY",
    ]
    secret_hits: list[str] = []
    for root in package_roots:
        paths = root.rglob("*")
        for path in paths:
            if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if any(pattern in text for pattern in suspicious_secret_patterns):
                secret_hits.append(str(path.relative_to(SKILLS_ROOT)))
    return {
        "ok": not secret_hits,
        "scanned_roots": [str(path) for path in package_roots],
        "generated_files": generated,
        "generated_files_note": "ignored by .gitignore; remove before packaging if creating an archive" if generated else None,
        "secret_pattern_hits": secret_hits,
    }


def _guidance_first_check() -> dict[str, Any]:
    text = (FORMALIZATION_ROOT / "SKILL.md").read_text(encoding="utf-8", errors="replace")
    orchestration = (RUNTIME_ROOT / "references" / "interactive_orchestration.md").read_text(encoding="utf-8", errors="replace")
    required_phrases = [
        "## Agent Playbook",
        "## Helper Toolbox",
        "This is a coding-agent-first Lean skill.",
        "The coding agent is the primary Lean worker.",
        "Lean-specialist backend adapters are adapter-first optional escalation paths.",
        "adapter-first",
        "Built-in recommended adapter: official Numina Lean Agent runtime",
        "Numina and Archon are recommended adapter candidates, not defaults or hard requirements",
        "Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist",
        "do not call any backend until deployment, readiness checks, invocation, validation, and failure triage are documented",
        "Default coding-agent Lean work must not require any backend adapter.",
        "Use a backend adapter only when the user asks for the official Lean Agent, Numina, Archon, batch proof search, or an approved external subagent run.",
        "Default execution mode is coding-agent mode.",
        "Incorporate publicly documented Lean-specialist agent patterns into the default coding-agent workflow.",
        "Treat specialist-agent patterns as mechanisms, not mandatory external services.",
        "This skill must act as a distilled Lean-agent capability layer",
        "lean_agent_capability_map.md",
        "lean_lsp_mcp_adapter.md",
        "project gate, statement normalization, local context pack, retrieve-before-inventing, bounded tactic/proof attempts, failed-route memory, local validation, and minimal failure handoff",
        "Use the bundled smoke test when no user target is available.",
        "Lead the interaction; do not wait for the user to drive every step.",
        "If the user's language is ambiguous, default to Chinese.",
        "A language switch is not a task reset.",
        "If no target is available, run or propose a safe local smoke/readiness check.",
        "Avoid ending with only \"send me a file\"",
        "Opening readiness should inspect local Lean readiness first",
        "inspect Numina or another backend readiness only when the user asks for an optional Lean-specialist backend",
        "Do not require API keys for the default coding-agent path.",
        "Shared workspace is the default Lean project context; Numina may target it instead of upstream examples.",
        "offer a small next-step menu",
        "Ask at most one blocking question at a time.",
        "The bundled CLI is a helper toolbox, not the workflow driver.",
        "Use backend adapters through a human-in-the-loop workflow.",
        "Do not turn helper commands into a closed proof workflow.",
        "Do not remove the built-in official Numina adapter recipe.",
    ]
    missing = [phrase for phrase in required_phrases if phrase not in text]
    orchestration_required = [
        "## Session Opening",
        "This is a coding-agent-first Lean skill.",
        "Backend integration is adapter-first.",
        "Built-in recommended adapter: official Numina Lean Agent runtime",
        "Numina and Archon are recommended adapter candidates, not defaults or hard requirements",
        "Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist",
        "The default coding-agent path should still absorb Lean-specialist agent mechanisms as a distilled Lean-agent loop:",
        "distilled Lean-agent loop",
        "local context packs",
        "retrieve-before-inventing",
        "lean_agent_capability_map.md",
        "lean_lsp_mcp_adapter.md",
        "Use the bundled smoke test when no user target is available.",
        "Lead the interaction; do not wait for the user to drive every step.",
        "A language switch is not a task reset.",
        "If no target is available, run or propose a safe local smoke/readiness check.",
        "Avoid ending with only \"send me a file\"",
        "Opening readiness should inspect local Lean readiness first",
        "Inspect Numina or another backend readiness only when the user asks for an optional Lean-specialist backend.",
        "Do not require API keys for the default coding-agent path.",
        "Shared workspace is the default Lean project context; Numina may target it instead of upstream examples.",
        "A good opening ends with one decision question, not a checklist.",
    ]
    orchestration_missing = [phrase for phrase in orchestration_required if phrase not in orchestration]
    openai_yaml = (FORMALIZATION_ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8", errors="replace")
    openai_required = [
        "请用中文开始",
        "如果用户明确使用其他语言",
        "默认走 distilled coding-agent Lean 工作流",
        "该 skill 参考并整合",
        "distilled coding-agent Lean 工作流",
        "Lean-agent capability distillation",
        "local context pack",
        "retrieve-before-inventing",
        "failed-route memory",
        "adapter-first",
        "当前内置推荐 adapter 是 official Numina Lean Agent runtime",
        "Numina 和 Archon 是推荐 adapter candidates，不是默认项或硬依赖",
        "Lean LSP/MCP 只有在用户明确要求",
        "其他 backend 可由 coding agent 按 backend adapter checklist 接入",
        "默认开场检查本地 Lean/shared workspace readiness",
        "仅当用户要求 optional backend 时再检查 backend readiness",
    ]
    openai_missing = [phrase for phrase in openai_required if phrase not in openai_yaml]
    return {
        "ok": not missing and not orchestration_missing and not openai_missing and "## Commands" not in text,
        "missing_phrases": missing,
        "orchestration_missing_phrases": orchestration_missing,
        "openai_yaml_missing_phrases": openai_missing,
        "commands_section_present": "## Commands" in text,
    }


def _root_discovery_boundary_check() -> dict[str, Any]:
    repo_root = SKILLS_ROOT.parent
    root_skill = repo_root / "SKILL.md"
    if not root_skill.exists():
        return {
            "ok": True,
            "root_skill": None,
            "skipped": True,
            "root_setup_only_trigger_hits": [],
        }
    text = root_skill.read_text(encoding="utf-8", errors="replace")
    frontmatter = text.split("---", 2)[1] if text.startswith("---") and text.count("---") >= 2 else text
    setup_only_triggers = [
        "Lean environment setup",
        "installing Lean",
        "install Lean",
        "checking elan",
        "elan/lake",
        "mathlib workspace",
        "shared Lean environment",
    ]
    hits = [phrase for phrase in setup_only_triggers if phrase in frontmatter]
    return {
        "ok": not hits,
        "root_skill": str(root_skill),
        "skipped": False,
        "root_setup_only_trigger_hits": hits,
    }


def _lean_setup_entrypoint_check() -> dict[str, Any]:
    skill_path = SETUP_ROOT / "SKILL.md"
    openai_path = SETUP_ROOT / "agents" / "openai.yaml"
    helper_script = RUNTIME_ROOT / "scripts" / "ai4m_lean.py"
    required_files = [skill_path, openai_path]
    if not all(path.exists() for path in required_files):
        return {
            "ok": False,
            "setup_root": str(SETUP_ROOT),
            "helper_script": str(helper_script),
            "helper_script_exists": helper_script.exists(),
            "missing_files": [str(path) for path in required_files if not path.exists()],
            "missing_phrases": [],
            "openai_yaml_missing_phrases": [],
            "repo_root_command_hits": [],
        }
    text = skill_path.read_text(encoding="utf-8", errors="replace")
    openai_yaml = openai_path.read_text(encoding="utf-8", errors="replace")
    required_phrases = [
        "Use this setup-only entrypoint",
        "Do not ask for a theorem target in setup-only mode.",
        "The shared implementation lives in `../lean-runtime/`.",
        "../lean-runtime/scripts/ai4m_lean.py",
        "Install Lean through the official `elan` channel",
        "When creating an isolated test directory or workspace",
        "suggest a safe default name",
        "use the default if the user has no naming preference",
        "canonical managed workspace",
        "AI4Math managed baseline toolchain `leanprover/lean4:v4.28.0`",
        "reuse it instead of rebuilding or downloading again",
        "Do not overwrite the canonical managed workspace",
        "lean-workspaces/<version-key>/",
        "After successful setup or smoke-test validation",
        "Offer a short next-step menu",
        "inspect an existing Lean/Lake project",
        "repair a Lean file or complete `sorry`",
        "formalize a natural-language or LaTeX theorem",
        "mention optional Numina only when the user explicitly asks",
        "Lean core ready",
        "mathlib ready",
        "partial readiness",
        "`import Mathlib` tasks are blocked",
        "Do not present this as full mathlib workspace readiness.",
        "Do not recommend formalization, `sorry` completion, or Numina as the default next step while mathlib is missing.",
        "git ls-remote https://github.com/leanprover-community/mathlib4.git HEAD",
        "Remove-Item -Recurse -Force .lake\\packages\\mathlib",
        "Do not require API keys for Lean/mathlib workspace setup.",
        "hand off to `lean-formalization`",
    ]
    repo_root_commands = [
        "python skills/lean-formalization/scripts/ai4m_lean.py",
    ]
    repo_root_command_hits = [phrase for phrase in repo_root_commands if phrase in text]
    openai_required = [
        "不要向用户索要 theorem target",
        "已有 Lake 项目优先沿用项目自己的 lean-toolchain 和 lake-manifest",
        "standalone 任务默认复用 ~/.ai4math/lean-workspace",
        "AI4Math managed baseline leanprover/lean4:v4.28.0",
        "避免重复下载和路径分裂",
        "setup 完成后主动给出下一步菜单",
        "区分 Lean core ready 和 mathlib ready",
        "mathlib 未完成时不要把正式形式化、sorry completion 或 Numina 作为默认下一步",
        "所有实现应复用 lean-runtime",
        "默认 Lean/mathlib 环境配置不需要 API key",
        "不要把 Numina 或其他 backend 放进默认下一步",
        "应交接到 lean-formalization",
    ]
    return {
        "ok": (
            helper_script.exists()
            and not repo_root_command_hits
            and all(phrase in text for phrase in required_phrases)
            and all(phrase in openai_yaml for phrase in openai_required)
        ),
        "setup_root": str(SETUP_ROOT),
        "helper_script": str(helper_script),
        "helper_script_exists": helper_script.exists(),
        "missing_phrases": [phrase for phrase in required_phrases if phrase not in text],
        "openai_yaml_missing_phrases": [phrase for phrase in openai_required if phrase not in openai_yaml],
        "repo_root_command_hits": repo_root_command_hits,
    }


def verify(
    cwd: str | Path = ".",
    require_environment: bool = False,
    include_workspace_build: bool = False,
    run_tests: bool = False,
) -> dict[str, Any]:
    cwd_path = Path(cwd).resolve()
    files = [
        {"path": f"lean-formalization/{item}", "exists": (FORMALIZATION_ROOT / item).exists()}
        for item in REQUIRED_FORMALIZATION_FILES
    ] + [
        {"path": f"lean-runtime/{item}", "exists": (RUNTIME_ROOT / item).exists()}
        for item in REQUIRED_RUNTIME_FILES
    ]
    commands = _parser_commands()
    schemas = []
    for name in ("task.schema.json", "result.schema.json", "config.schema.json"):
        path = RUNTIME_ROOT / "schemas" / name
        try:
            _load_schema(path)
            schemas.append({"path": f"schemas/{name}", "ok": True})
        except Exception as exc:  # noqa: BLE001 - report schema parse failure in JSON
            schemas.append({"path": f"schemas/{name}", "ok": False, "error": str(exc)})

    fixtures = RUNTIME_ROOT / "tests" / "fixtures"
    with tempfile.TemporaryDirectory() as tmp:
        dry_root = Path(tmp)
        dry_target = dry_root / "Failure.lean"
        (dry_root / "lean-toolchain").write_text("leanprover/lean4:v4.28.0\n", encoding="utf-8")
        (dry_root / "lakefile.toml").write_text('name = "verify_delivery"\n', encoding="utf-8")
        dry_target.write_text((fixtures / "failure.lean").read_text(encoding="utf-8"), encoding="utf-8")
        dry_run = run_direct_task("prove", dry_root, dry_target, dry_run=True)
    review = review_files(fixtures / "before.lean", fixtures / "after_bad.lean")
    failure = extract(fixtures / "failure.lean", target=None, run_lean=False)
    smoke = run_smoke_test(cwd_path, dry_run=True)

    tool_report = doctor(cwd_path) if require_environment else None
    env_report = inspect_environment(cwd_path) if require_environment else None
    workspace_check = None
    workspace_build = None
    if include_workspace_build:
        env_for_workspace = env_report or inspect_environment(cwd_path)
        workspace_root = env_for_workspace.get("lean", {}).get("workspace_project_root")
        if workspace_root:
            workspace_check = check_project(workspace_root, skip_build=True)
            lake = find_tool("lake") or "lake"
            workspace_build = run_command([lake, "build"], cwd=workspace_root, timeout=1800)
        else:
            workspace_check = {"ok": False, "status": "missing_workspace"}

    tests = None
    if run_tests:
        tests = run_command([sys.executable, "-m", "unittest", "discover", "-s", str(RUNTIME_ROOT / "tests")], cwd=RUNTIME_ROOT, timeout=300)

    hygiene = _package_hygiene()
    guidance_first = _guidance_first_check()
    discovery_boundaries = _root_discovery_boundary_check()
    lean_setup_entrypoint = _lean_setup_entrypoint_check()
    checks = {
        "required_files": all(item["exists"] for item in files),
        "required_commands": REQUIRED_COMMANDS.issubset(commands),
        "no_parallel_numina_commands": not any(command.startswith("numina") for command in commands),
        "schemas": all(item["ok"] for item in schemas),
        "guidance_first_skill": bool(guidance_first.get("ok")),
        "discovery_boundaries": bool(discovery_boundaries.get("ok")),
        "lean_setup_entrypoint": bool(lean_setup_entrypoint.get("ok")),
        "dry_run_prove": bool(dry_run.get("ok") and dry_run.get("status") == "dry_run"),
        "patch_guard": bool(not review.get("ok") and review.get("findings")),
        "minimal_failure": bool(failure.get("ok") and failure.get("minimal_failure", {}).get("snippet")),
        "bundled_smoke_test": bool(smoke.get("ok") and smoke.get("status") == "dry_run" and Path(smoke.get("smoke_file", "")).exists()),
        "package_hygiene": bool(hygiene.get("ok")),
    }
    if require_environment:
        checks["tool_environment"] = bool(tool_report and tool_report.get("ok"))
        checks["lean_agent_environment"] = bool(env_report and env_report.get("ok"))
    if include_workspace_build:
        checks["workspace_check"] = bool(workspace_check and workspace_check.get("ok"))
        checks["workspace_build"] = bool(workspace_build and workspace_build.get("ok"))
    if run_tests:
        checks["unit_tests"] = bool(tests and tests.get("ok"))

    ok = all(checks.values())
    return {
        "ok": ok,
        "status": "delivery_ready" if ok else "delivery_blocked",
        "cwd": str(cwd_path),
        "runtime_root": str(RUNTIME_ROOT),
        "formalization_root": str(FORMALIZATION_ROOT),
        "setup_root": str(SETUP_ROOT),
        "checks": checks,
        "files": files,
        "commands": {
            "required": sorted(REQUIRED_COMMANDS),
            "available": sorted(commands),
            "missing": sorted(REQUIRED_COMMANDS - commands),
        },
        "schemas": schemas,
        "guidance_first_skill": guidance_first,
        "discovery_boundaries": discovery_boundaries,
        "lean_setup_entrypoint": lean_setup_entrypoint,
        "dry_run_prove": {
            "ok": dry_run.get("ok"),
            "status": dry_run.get("status"),
            "backend": dry_run.get("backend"),
            "agent_mode": dry_run.get("agent_mode"),
            "missing_config": dry_run.get("missing_config"),
        },
        "patch_guard": {
            "ok": review.get("ok"),
            "status": review.get("status"),
            "finding_count": len(review.get("findings", [])),
        },
        "minimal_failure": {
            "ok": failure.get("ok"),
            "status": failure.get("status"),
            "start_line": failure.get("minimal_failure", {}).get("start_line"),
            "end_line": failure.get("minimal_failure", {}).get("end_line"),
        },
        "bundled_smoke_test": {
            "ok": smoke.get("ok"),
            "status": smoke.get("status"),
            "smoke_file": smoke.get("smoke_file"),
            "project_root": smoke.get("project_root"),
        },
        "hygiene": hygiene,
        "tool_environment": tool_report,
        "lean_agent_environment": env_report,
        "workspace_check": workspace_check,
        "workspace_build": workspace_build,
        "unit_tests": tests,
        "external_api_note": "env, doctor, check, review, tests, and dry-runs do not call external APIs. configure --setup-numina and approved official Numina runs may clone/install/call external tools, then final Lean changes must be validated locally.",
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Verify Lean Formalization delivery readiness")
    parser.add_argument("--cwd", default=".")
    parser.add_argument("--require-environment", action="store_true")
    parser.add_argument("--include-workspace-build", action="store_true")
    parser.add_argument("--run-tests", action="store_true")
    args = parser.parse_args(argv)
    result = verify(
        cwd=args.cwd,
        require_environment=args.require_environment,
        include_workspace_build=args.include_workspace_build,
        run_tests=args.run_tests,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
