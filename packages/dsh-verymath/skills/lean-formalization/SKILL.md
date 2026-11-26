---
name: lean-formalization
description: Use for interactive Lean 4 formal verification by coding agents with reusable Lean/mathlib workspaces, theorem formalization, proof repair, sorry completion, patch review, optional adapter-first Lean-specialist backend work, and minimal failure handoff.
---

# Lean Formalization

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；`lean-runtime/` 支撑层随包内嵌于本技能目录
  （上游为兄弟目录；此处按 DSH 技能发现约定调整，所有 `lean-runtime/` 引用改读 `lean-runtime/`）。
- DSH 工具优先：`verymath_lean_detect_sorry`（无 Lean 也可用的 sorry/admit/axiom 纯文本检测）。
  patch 结构安全审查（陈述漂移 + 禁用词）用随包脚本 `python3 lean-runtime/scripts/ai4m_lean.py review`
  经 bash 执行；环境探测用 `ai4m_lean.py doctor` / `env`（同样是 bash）。本插件没有额外的 lean 审查工具。
- 编译验证（lake build / lake env lean）需要真实 Lean 工具链，先跑 `ai4m_lean.py doctor` 看两级 readiness；
  **elan shim 陷阱**——`.elan/bin` 下的 lean/lake 不可跑 `--version`（会触发 GB 级隐式工具链下载），
  版本一律从项目 `lean-toolchain` 文件读取。
- mathlib 缓存与共享工作区概念（`${AI4MATH_HOME:-~/.ai4math}/lean-workspace`）继续适用；
  安装/下载一律先经用户批准。
- Numina/Archon 后端为可选 adapter，默认路径不需要任何 API key；DSH 接入默认不配置后端。

Use this skill when the user wants a coding agent to do Lean 4 formalization, proof repair, theorem transcription, sorry completion, review of a Lean patch, or optional Lean-specialist backend work.

If the user only wants Lean 4, `elan`, `lake`, or a reusable mathlib workspace configured, use the sibling `../lean-setup/SKILL.md` entrypoint and do not ask for a theorem target.

Shared scripts, prompts, schemas, examples, and references live in the non-user-facing `lean-runtime/` support layer. Treat `lean-setup` and `lean-formalization` as the two public entrypoints; do not ask users to invoke `lean-runtime` directly.

This is a coding-agent-first Lean skill. The coding agent is the primary Lean worker. It reads and edits Lean files, runs Lean/Lake checks, diagnoses errors, preserves theorem statements, and iterates with the user. Default execution mode is coding-agent mode.

Incorporate publicly documented Lean-specialist agent patterns into the default coding-agent workflow. Use systems such as Numina, LeanDojo/ReProver, LeanCopilot, COPRA-style proof search, Lean LSP, MCP, and lightweight iterative proof agents as related-work references for mechanisms such as project gating, statement normalization, theorem-state loops, premise retrieval, bounded tactic/proof search, validation oracles, failure memory, and minimized handoff. Treat specialist-agent patterns as mechanisms, not mandatory external services.

This skill must act as a distilled Lean-agent capability layer, not only as a list of related projects. The default path should execute the distilled loop from `lean-runtime/references/lean_agent_capability_map.md`: project gate, statement normalization, local context pack, retrieve-before-inventing, bounded tactic/proof attempts, failed-route memory, local validation, and minimal failure handoff. Use `lean-runtime/references/lean_lsp_mcp_adapter.md` when the user explicitly asks for Lean LSP/MCP, richer goal-state tooling, or MCP-backed theorem search.

Lean-specialist backend adapters are adapter-first optional escalation paths. Built-in recommended adapter: official Numina Lean Agent runtime. Numina and Archon are recommended adapter candidates, not defaults or hard requirements. Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist; do not call any backend until deployment, readiness checks, invocation, validation, and failure triage are documented. Use a backend adapter only when the user asks for the official Lean Agent, Numina, Archon, batch proof search, or an approved external subagent run.

Match the user's language by default. If the user's language is ambiguous, default to Chinese. If the user writes Chinese, respond in Chinese from the first turn unless they ask otherwise. A language switch is not a task reset. Keep the current environment state, prior diagnosis, and recommended next action, then continue leading in the new language.

Lead the interaction; do not wait for the user to drive every step. When the user's request is broad or underspecified, first orient yourself to the Lean project/workspace state, then propose the next useful action in plain language. Do not open with a passive "send me the file" checklist when you can inspect context or offer a concrete starting path.

If no target is available, run or propose a safe local smoke/readiness check. Use the bundled smoke test when no user target is available. Then recommend a default path, such as checking the shared Lean workspace, running the built-in smoke theorem, or inspecting a Lean project. Check backend readiness only when the user wants an optional Lean-specialist backend path. Avoid ending with only "send me a file" or an equivalent passive handoff.

The bundled CLI is a helper toolbox, not the workflow driver. Prefer normal coding-agent judgment, direct file edits, `rg`, Lean/Lake validation, and repository context. Use helper commands only when their deterministic output is useful.

Use backend adapters through a human-in-the-loop workflow. The built-in recommended Numina adapter lives under shared local state at `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/`; the coding agent explains clone, setup, API-key, proxy/MCP, and upstream runner implications before running setup or calling the official runner. Archon and other backend adapters must follow `lean-runtime/references/backend_adapter_checklist.md`. Do not turn helper commands into a closed proof workflow.

Opening readiness should inspect local Lean readiness first; inspect Numina or another backend readiness only when the user asks for an optional Lean-specialist backend. Do not require API keys for the default coding-agent path. Default coding-agent Lean work must not require any backend adapter. Shared workspace is the default Lean project context; Numina may target it instead of upstream examples.

Do not remove the built-in official Numina adapter recipe. Treat Numina and Archon as recommended adapter candidates with explicit approval, while keeping the direct coding-agent Lean workflow useful without external APIs.

## Agent Playbook

1. Start by orienting the session: inspect the current repository/workspace when possible, distinguish an existing Lake project, shared Lean workspace, and local Lean validation readiness, then summarize what is already usable. Mention Numina runtime or credentials/auth only when the user asks for an optional backend adapter path. Treat upstream Numina example projects as demos only; do not let their pinned `lean-toolchain` make the shared workspace look broken.
2. If the user has not provided a precise target, offer a small next-step menu such as run the bundled smoke test, repair an existing Lean file, formalize a natural-language/LaTeX theorem, or inspect a Lean project. Include backend readiness or credential setup only when the user asks for an optional backend adapter path. Recommend one default path based on what inspection found.
3. Ask at most one blocking question at a time. Prefer a concrete recommendation plus one decision question over a list of required inputs.
4. Understand the user's intent: direct coding-agent repair/formalization, configure or call a backend adapter, repair a file, formalize a statement, prove a target, complete `sorry`, review a patch, batch a folder, or minimize a failure.
5. Locate the relevant Lean project, files, declarations, imports, and current errors. Use the user's existing Lake project when available; otherwise use the shared workspace as the coding-agent project context and optional Numina target project.
6. For standalone files, use or create the shared workspace `${AI4MATH_HOME:-~/.ai4math}/lean-workspace`; do not create a second project-local workspace unless the user asks for isolation.
7. When reporting readiness, lead with local Lean readiness. Report backend readiness only when the optional backend adapter path is requested. If backend credentials are missing, say that only the optional backend adapter path needs configuration.
8. Before any backend adapter setup or run, inspect readiness, explain the deployment/call, target project, prompt, result directory, credential/proxy/MCP state, and local validation plan; proceed only after approval.
9. For natural-language or LaTeX input, draft the Lean declaration and ask for confirmation before long proof work.
10. Edit Lean directly in small steps for the default coding-agent path, using the distilled Lean-agent loop: inspect theorem state, build a local context pack, retrieve nearby lemmas before inventing, run bounded proof attempts, record failed routes, and extract minimal failures when blocked. If a backend adapter is approved, call it for proof search/formalization, then run Lean/Lake validation and patch safety checks before accepting results.
11. Preserve theorem statements unless the user explicitly approves a change.
12. Reject final patches that contain `sorry`, `admit`, or newly introduced `axiom`.
13. If blocked, stop cleanly with the smallest useful failing Lean fragment, exact errors/goals, and the next mathematical decision needed.

## Helper Toolbox

Use `python lean-runtime/scripts/ai4m_lean.py <command>` when it saves effort or reduces risk:

- `env` / `doctor`: inspect Lean workspace, local tool availability, and optional backend readiness when requested.
- `configure --create-workspace`: create or reuse the shared managed workspace.
- `configure --setup-numina --project-name <name>`: after user approval, clone/configure the official Numina runtime under `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/`.
- `smoke-test`: run the bundled `lean-runtime/examples/smoke/LocalLeanSmoke.lean` target in the shared workspace without external API calls; this is a local Lean smoke theorem, not a Numina run.
- `check`: run a structured Lean/Lake validation.
- `review` / `detect-sorry`: guard against placeholders, axioms, and statement drift.
- `minimize-failure`: extract a compact failing Lean fragment.
- `prove` / `formalize` / `repair` / `complete-sorries` / `batch`: optional dry-run task envelopes for coding-agent bookkeeping; use a backend adapter only when the optional backend path is approved and documented.
- `verify-delivery`: validate this skill package.

All helper commands emit machine-readable JSON on stdout. Human-readable diagnostics go to stderr or log files.

## Numina Runtime

When using the built-in recommended Numina adapter, follow `lean-runtime/references/numina_runtime.md`. For auth/proxy/MCP/failure triage, follow `lean-runtime/references/numina_subagent_troubleshooting.md`. For Archon or any other backend adapter, follow `lean-runtime/references/backend_adapter_checklist.md`. Proof strategy is a human-in-the-loop process with the user, the coding agent, local Lean checks, and, when approved, a documented backend adapter.

## Safety Rules

- Do not call external model APIs or mutate Numina runtime state without approval.
- If the user asks for the official Lean Agent, Numina, Archon, batch proof search, or external subagent, explain needed credentials/setup directly.
- Do not commit local machine-specific paths.
- Do not call external APIs during `env`, `doctor`, `check`, `review`, `detect-sorry`, tests, or dry-runs.
- Do not store secrets in tracked files; use environment variables or `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/.env.local`.
- Do not accept final Lean patches containing `sorry`, `admit`, or newly introduced `axiom`.
- Do not silently weaken theorem statements or change existing project versions.
- Do not let helper command availability override a better coding-agent path.
- Do not remove the built-in official Numina adapter recipe.

## References

- Read `lean-runtime/references/direct_lean_workflow.md` for the default coding-agent proof/repair/formalization loop.
- Read `lean-runtime/references/lean_agent_capability_map.md` when checking whether Lean-agent abilities have been distilled into the default workflow or delegated to adapters.
- Read `lean-runtime/references/lean_lsp_mcp_adapter.md` when the user asks to connect Lean LSP/MCP, goal-state MCP tooling, or MCP-backed theorem search.
- Read `lean-runtime/references/specialist_agent_patterns.md` when adapting ideas from Numina, LeanDojo/ReProver, LeanCopilot, COPRA-style proof search, Lean LSP/MCP, or other Lean-specialist agents.
- Read `lean-runtime/references/lean_runtime_configuration.md` when setting up or diagnosing the reusable Lean workspace.
- Read `lean-runtime/references/numina_runtime.md` when the user wants the official Numina deployment/call path.
- Read `lean-runtime/references/numina_subagent_troubleshooting.md` when Numina auth, proxy, MCP, or runner failures appear.
- Read `lean-runtime/references/backend_adapter_checklist.md` before connecting Archon or any other backend adapter.
- Read `lean-runtime/references/interactive_orchestration.md` when guiding user intake and task decomposition.
- Read `lean-runtime/references/review_checklist.md` before accepting a Lean patch.
- Read `lean-runtime/references/failure_taxonomy.md` when reporting a blocked proof.
- Read `lean-runtime/references/numina_reverse_analysis.md` when explaining which Numina mechanisms are incorporated locally and which are delegated to the optional official runtime.
