---
name: lean-setup
description: Use when a coding agent needs to install or verify Lean 4, elan, lake, create or reuse a mathlib workspace, configure a shared Lean environment, or run Lean readiness checks before formalization.
---

# Lean Setup

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；共享支撑层位于
  `../lean-formalization/lean-runtime/`（DSH 捆绑布局；上游为兄弟目录 lean-runtime/）。
- 先调 `verymath_lean_check` 拿两级 readiness（leanCoreReady / mathlibReady / partial）；
  缺失组件的安装提示原样告知用户，**绝不自动安装**（安装必须用户批准）。
- 工具链版本从项目的 `lean-toolchain` 文件读取；不要对 `.elan/bin` 下的 shim 跑 `--version`。

Use this setup-only entrypoint when the user only wants a Lean 4 environment, `elan`/`lake` readiness, or a reusable mathlib workspace. Do not ask for a theorem target in setup-only mode.

The shared implementation lives in `../lean-formalization/lean-runtime/`. This skill must reuse the same helper CLI, configuration rules, and runtime references rather than duplicating setup logic or depending on the formalization entrypoint.

## Setup-Only Flow

1. Match the user's language by default; if ambiguous, default to Chinese.
2. Inspect tool and workspace readiness with `doctor` or `env`.
3. If `elan`, `lean`, or `lake` is missing, explain the required Lean installation step first. Install Lean through the official `elan` channel appropriate for the user's OS after approval; `lean` and `lake` should come from the `elan` toolchain rather than a repository-local copy.
4. Prefer an existing Lake project when the user points to one.
5. When creating an isolated test directory or workspace, suggest a safe default name and let the user confirm or rename it; use the default if the user has no naming preference.
6. For standalone future Lean work, create or reuse the canonical managed workspace `${AI4MATH_HOME:-~/.ai4math}/lean-workspace` with the AI4Math managed baseline toolchain `leanprover/lean4:v4.28.0`.
7. Create the workspace only after explaining that Lean/mathlib artifacts may be downloaded or built. If the canonical workspace already exists and is complete, reuse it instead of rebuilding or downloading again.
8. Run the bundled smoke test after setup.
9. Report the installed tools, workspace path, Lean toolchain, mathlib revision when available, smoke-test result, and any remaining action. Distinguish Lean core ready from mathlib ready.
10. If Lean toolchain and pure Lean smoke tests pass but `lake update`, `lake exe cache get`, `lake build`, or `import Mathlib` is blocked by GitHub/network/cache failure, report partial readiness instead of total failure or full success.
11. After successful setup or smoke-test validation, do not end passively. Offer a short next-step menu and recommend one default next action.
12. Include an optional cross-platform IDE frontend path in that menu: identify the user's OS when needed, then guide them to install or verify VS Code with the Lean 4 extension on macOS, Windows, or Linux, open the verified Lake project or shared workspace, open a known passing `.lean` file, and confirm Lean InfoView is connected to the same toolchain that passed local validation.
13. If the user next wants formalization, proof repair, theorem transcription, `sorry` completion, patch review, or Numina proof search, hand off to `lean-formalization`.

## Readiness Levels

Report setup status in two layers:

- Lean core ready: `lean --version`, `lake --version`, and a pure Lean smoke theorem pass.
- mathlib ready: the workspace can run `lake update`, `lake exe cache get`, `lake build`, and a file with `import Mathlib`.

If Lean core ready passes but mathlib ready fails because GitHub, proxy, or cache download is unavailable, call it partial readiness. `import Mathlib` tasks are blocked, but pure `.lean` files and basic Lean compilation can still be verified. Do not present this as full mathlib workspace readiness. Do not recommend formalization, `sorry` completion, or Numina as the default next step while mathlib is missing. The default next step should be to diagnose Git/mathlib access or continue only with pure Lean smoke validation.

For Windows mathlib clone/cache failures, use copyable recovery commands such as:

```powershell
git ls-remote https://github.com/leanprover-community/mathlib4.git HEAD
Remove-Item -Recurse -Force .lake\packages\mathlib
lake update
lake exe cache get
lake build
```

If `git ls-remote` fails, diagnose Git proxy/network inheritance before rerunning Lake. If it succeeds but Lake reports that `.lake\packages\mathlib` cannot resolve `HEAD`, remove that corrupted package directory and rerun `lake update`.

## Post-Setup Guidance

Offer a short next-step menu after setup succeeds:

- inspect an existing Lean/Lake project;
- run or explain the built-in smoke theorem result;
- configure the VS Code / Lean 4 extension frontend for the verified project on macOS, Windows, or Linux, and confirm Lean InfoView works;
- repair a Lean file or complete `sorry`;
- formalize a natural-language or LaTeX theorem;
- continue setup-only validation if the user only wants environment readiness.

If only partial readiness is available, limit the default menu to Git/mathlib recovery, pure Lean smoke validation, or IDE frontend verification for the same pure Lean file. Do not offer Mathlib-dependent proof work as ready.

As a rule, mention optional Numina only when the user explicitly asks for the official Lean Agent, batch proof search, or an external backend adapter; do not make Numina or API keys part of the default next step.

## Commands

Resolve the helper from the shared runtime path `../lean-formalization/lean-runtime/scripts/ai4m_lean.py`, then run it with `--cwd <target-project-or-workspace>`. In a source checkout this is the same helper under `skills/lean-runtime/scripts/ai4m_lean.py`.

```bash
python ../lean-formalization/lean-runtime/scripts/ai4m_lean.py doctor --cwd <target-project-or-workspace>
python ../lean-formalization/lean-runtime/scripts/ai4m_lean.py env --cwd <target-project-or-workspace>
python ../lean-formalization/lean-runtime/scripts/ai4m_lean.py configure --cwd <target-project-or-workspace> --create-workspace
python ../lean-formalization/lean-runtime/scripts/ai4m_lean.py smoke-test --cwd <target-project-or-workspace>
```

Use `--dry-run` before setup when the user wants to review commands.

## Boundaries

- Do not create a second setup implementation.
- Do not change a user project's `lean-toolchain` or mathlib revision without approval.
- Do not overwrite the canonical managed workspace for a different Lean/mathlib revision. Use `${AI4MATH_HOME:-~/.ai4math}/lean-workspaces/<version-key>/` only when the user explicitly needs a different standalone version.
- Do not require API keys for Lean/mathlib workspace setup.
- Do not require VS Code, Lean InfoView, or any IDE frontend for headless setup validation; offer it as a recommended human-facing follow-up after Lean/Lake readiness is confirmed.
- Do not configure or call official Numina unless the user explicitly asks for that optional backend.
- Do not commit machine-specific paths, downloaded runtime state, or secrets.

## References

- Read `../lean-formalization/lean-runtime/references/lean_runtime_configuration.md` for shared workspace layout, local configuration, and version policy.
- Read `../lean-formalization/lean-runtime/references/numina_runtime.md` only when the user asks for optional official Numina setup.
- Use `../lean-formalization/lean-runtime/scripts/ai4m_lean.py verify-delivery --cwd . --run-tests` for package validation.
