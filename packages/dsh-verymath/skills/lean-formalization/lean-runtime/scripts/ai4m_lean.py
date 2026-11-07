#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from check_lean_project import check_file, check_project
from common import emit_json
from configure_lean import configure, inspect_environment
from detect_sorry import scan_file
from direct_task import run_direct_task
from extract_minimal_failure import extract
from numina_runtime import numina_readiness
from smoke_test import run_smoke_test
from tool_status import doctor
from validate_patch import review_files
from verify_delivery import verify as verify_delivery


EXIT_OK = 0
EXIT_MISSING_CONFIG = 4
EXIT_LEAN_FAILED = 6
EXIT_PATCH_VIOLATION = 7
EXIT_INTERACTIVE_REQUIRED = 10


def _exit_code(result: dict[str, Any], default_fail: int = 1) -> int:
    if result.get("ok"):
        return EXIT_OK
    status = result.get("status")
    if status in {"missing_config", "direct_task_missing_config"}:
        return EXIT_MISSING_CONFIG
    if status in {"missing_lean_project", "lean_build_failed", "lean_file_failed", "lean_workspace_setup_failed"}:
        return EXIT_LEAN_FAILED
    if status == "patch_safety_violation":
        return EXIT_PATCH_VIOLATION
    if status == "interactive_required":
        return EXIT_INTERACTIVE_REQUIRED
    return default_fail


def _finish(result: dict[str, Any], json_output: str | None = None, fail_code: int = 1) -> None:
    emit_json(result, json_output=json_output)
    raise SystemExit(_exit_code(result, default_fail=fail_code))


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cwd", default=".", help="Lean project or workspace directory")
    parser.add_argument("--config", default=None, help="Optional TOML config path")
    parser.add_argument("--json-output", default=None, help="Write JSON result to this path")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AI4Math coding-agent Lean skill CLI with optional Lean-specialist backend adapter support")
    sub = parser.add_subparsers(dest="command", required=True)

    env = sub.add_parser("env", help="Inspect Lean workspace and optional backend adapter environment")
    add_common(env)
    env.add_argument("--target", default=None)

    doctor_parser = sub.add_parser("doctor", help="Report local tool availability")
    add_common(doctor_parser)

    check = sub.add_parser("check", help="Check Lean project or file")
    add_common(check)
    check.add_argument("--file", default=None)
    check.add_argument("--skip-build", action="store_true")
    check.add_argument("--timeout", type=int, default=300)

    smoke = sub.add_parser("smoke-test", help="Run the bundled Lean smoke target in the shared workspace")
    add_common(smoke)
    smoke.add_argument("--timeout", type=int, default=120)
    smoke.add_argument("--dry-run", action="store_true")

    configure_parser = sub.add_parser("configure", help="Inspect or create local Lean workspace configuration")
    add_common(configure_parser)
    configure_parser.add_argument("--target", default=None)
    configure_parser.add_argument("--create-workspace", action="store_true")
    configure_parser.add_argument("--toolchain", default=None, help="Override the default AI4Math managed workspace toolchain")
    configure_parser.add_argument("--save-local", action="store_true")
    configure_parser.add_argument("--dry-run", action="store_true")
    configure_parser.add_argument("--setup-numina", action="store_true", help="Install/configure official Numina runtime after review")
    configure_parser.add_argument("--project-name", default=None, help="Lean project name for official Numina tutorial setup")

    for name in ("prove", "formalize", "repair", "complete-sorries"):
        proof = sub.add_parser(name, help=f"Prepare a coding-agent {name} task")
        add_common(proof)
        proof.add_argument("--file", required=True)
        proof.add_argument("--target", default=None)
        proof.add_argument("--max-rounds", type=int, default=5)
        proof.add_argument("--prompt-file", default=None)
        proof.add_argument("--result-dir", default=None)
        proof.add_argument("--dry-run", action="store_true")
        if name == "formalize":
            proof.add_argument("--statement-file", default=None)

    batch = sub.add_parser("batch", help="Prepare a coding-agent folder task")
    add_common(batch)
    batch.add_argument("--folder", required=True)
    batch.add_argument("--max-rounds", type=int, default=5)
    batch.add_argument("--prompt-file", default=None)
    batch.add_argument("--result-dir", default=None)
    batch.add_argument("--dry-run", action="store_true")

    review = sub.add_parser("review", help="Review before/after Lean patch")
    review.add_argument("--before", required=True)
    review.add_argument("--after", required=True)
    review.add_argument("--allow-statement-changes", action="store_true")
    review.add_argument("--json-output", default=None)

    detect = sub.add_parser("detect-sorry", help="Detect sorry/admit/axiom")
    detect.add_argument("--file", required=True)
    detect.add_argument("--json-output", default=None)

    minimize = sub.add_parser("minimize-failure", help="Extract a small failing Lean fragment")
    add_common(minimize)
    minimize.add_argument("--file", required=True)
    minimize.add_argument("--target", default=None)
    minimize.add_argument("--run-lean", action="store_true")
    minimize.add_argument("--timeout", type=int, default=120)

    delivery = sub.add_parser("verify-delivery", help="Run delivery readiness checks for this skill")
    add_common(delivery)
    delivery.add_argument("--require-environment", action="store_true")
    delivery.add_argument("--include-workspace-build", action="store_true")
    delivery.add_argument("--run-tests", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    if args.command == "env":
        result = inspect_environment(args.cwd, config_path=args.config, target=args.target)
        _finish(result, args.json_output, fail_code=EXIT_MISSING_CONFIG)

    if args.command == "doctor":
        result = doctor(args.cwd)
        result["numina"] = numina_readiness(args.cwd)
        _finish(result, args.json_output)

    if args.command == "check":
        if args.file:
            result = check_project(args.cwd, skip_build=True, file=args.file, timeout=args.timeout) if args.skip_build else check_file(args.file, timeout=args.timeout)
        else:
            result = check_project(args.cwd, skip_build=args.skip_build, timeout=args.timeout)
        _finish(result, args.json_output, fail_code=EXIT_LEAN_FAILED)

    if args.command == "smoke-test":
        result = run_smoke_test(args.cwd, config_path=args.config, timeout=args.timeout, dry_run=args.dry_run)
        _finish(result, args.json_output, fail_code=EXIT_LEAN_FAILED)

    if args.command == "configure":
        result = configure(
            args.cwd,
            config_path=args.config,
            target=args.target,
            create_workspace=args.create_workspace,
            toolchain=args.toolchain,
            save_local=args.save_local,
            dry_run=args.dry_run,
            setup_numina=args.setup_numina,
            project_name=args.project_name,
        )
        _finish(result, args.json_output, fail_code=EXIT_INTERACTIVE_REQUIRED)

    if args.command in {"prove", "formalize", "repair", "complete-sorries"}:
        result = run_direct_task(
            args.command,
            cwd=args.cwd,
            target=args.file,
            max_rounds=args.max_rounds,
            config_path=args.config,
            prompt_file=args.prompt_file,
            result_dir=args.result_dir,
            dry_run=args.dry_run,
        )
        if args.command == "formalize" and args.statement_file:
            result["statement_file"] = str(Path(args.statement_file).expanduser().resolve())
        if args.target:
            result["target_declaration"] = args.target
        _finish(result, args.json_output, fail_code=EXIT_MISSING_CONFIG)

    if args.command == "batch":
        result = run_direct_task(
            "batch",
            cwd=args.cwd,
            target=args.folder,
            max_rounds=args.max_rounds,
            config_path=args.config,
            prompt_file=args.prompt_file,
            result_dir=args.result_dir,
            dry_run=args.dry_run,
        )
        _finish(result, args.json_output, fail_code=EXIT_MISSING_CONFIG)

    if args.command == "review":
        result = review_files(args.before, args.after, allow_statement_changes=args.allow_statement_changes)
        _finish(result, args.json_output, fail_code=EXIT_PATCH_VIOLATION)

    if args.command == "detect-sorry":
        result = scan_file(args.file)
        _finish(result, args.json_output, fail_code=EXIT_PATCH_VIOLATION)

    if args.command == "minimize-failure":
        result = extract(args.file, target=args.target, run_lean=args.run_lean, timeout=args.timeout)
        _finish(result, args.json_output, fail_code=EXIT_LEAN_FAILED)

    if args.command == "verify-delivery":
        result = verify_delivery(
            cwd=args.cwd,
            require_environment=args.require_environment,
            include_workspace_build=args.include_workspace_build,
            run_tests=args.run_tests,
        )
        _finish(result, args.json_output)


if __name__ == "__main__":
    main()
