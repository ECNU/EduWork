# Interactive Orchestration

The coordinating coding agent owns user interaction, Lean proof/formalization work, incorporated Lean-specialist agent patterns, adapter-first optional backend orchestration, and final validation. It can delegate proof search/formalization to a documented backend adapter when the user asks for that path.

This reference covers the guidance layer: session opening, intake, task classification, direct coding-agent Lean work, specialist-agent pattern selection, optional Lean-specialist backend adapter deployment/calls, local Lean validation, result review, bounded iteration, and minimal failure handoff.

## Session Opening

If the user's language is ambiguous, default to Chinese. The skill display name, repository name, or command name is not enough evidence to choose English.

This is a coding-agent-first Lean skill. Backend integration is adapter-first. Built-in recommended adapter: official Numina Lean Agent runtime. Numina and Archon are recommended adapter candidates, not defaults or hard requirements. Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist; do not call any backend until deployment, readiness checks, invocation, validation, and failure triage are documented.

The default coding-agent path should still absorb Lean-specialist agent mechanisms as a distilled Lean-agent loop: project gating, statement normalization, local context packs, theorem-state loops, retrieve-before-inventing, bounded proof search, failed-strategy memory, Lean/Lake validation, and minimized failure handoff. Use `lean_agent_capability_map.md` to distinguish default distilled capabilities from adapter-only capabilities.

Lead the interaction; do not wait for the user to drive every step. On a broad request, first orient to the current state instead of asking for every input at once:

- inspect whether the current directory is a Lake project;
- check whether the shared `${AI4MATH_HOME:-~/.ai4math}/lean-workspace` exists;
- inspect local Lean/Lake readiness and shared workspace state;
- inspect backend runtime, upstream checkout, tools, and credential/auth readiness only when the user asks for an optional backend adapter;
- say what can be done immediately and what would require confirmation.

Opening readiness should inspect local Lean readiness first. Inspect Numina or another backend readiness only when the user asks for an optional Lean-specialist backend. Do not require API keys for the default coding-agent path. Shared workspace is the default Lean project context; Numina may target it instead of upstream examples.

When checking Numina, distinguish runtime readiness from upstream demo readiness. The runtime can be usable with the shared Lean workspace even if an upstream example or benchmark pins a different `lean-toolchain`. Report that as an example-project issue, not as a failure of the shared environment.

A language switch is not a task reset. Restate the current state in the user's language, keep the prior diagnosis, and continue with the recommended next action instead of returning to generic intake.

If no target is available, run or propose a safe local smoke/readiness check. Use the bundled smoke test when no user target is available. Good examples are `smoke-test` against `examples/smoke/LocalLeanSmoke.lean`, `lake build` for the user's current Lake project when it is already present, or a helper `doctor` check when environment status is the question. Avoid ending with only "send me a file" or an equivalent passive handoff.

If no precise target is provided, offer a small menu and recommend one path. For example:

- run the bundled smoke test to verify the local Lean/mathlib validation layer;
- repair or complete an existing Lean file with the coding agent;
- formalize a natural-language or LaTeX theorem with the coding agent;
- inspect a Lean/Lake project and summarize readiness;
- if the user asks for an optional backend adapter, configure missing credentials/auth for that adapter;
- if the user asks for an optional backend adapter, run an adapter readiness check;
- if the user asks for an optional backend adapter, prepare the shared workspace as the target project;
- if the user asks for an optional backend adapter, call the approved adapter on a natural-language/LaTeX theorem or Lean file.
- if the user asks for Lean LSP/MCP, read `lean_lsp_mcp_adapter.md`, explain MCP scope and security, then configure only after approval.

Ask at most one blocking question at a time. A good opening ends with one decision question, not a checklist.

## Intake Questions

Ask only when not inferable:

- Is this repair, theorem formalization, proof completion, sorry completion, patch review, or batch work?
- What target file/folder and declaration should be used?
- Is changing the theorem statement allowed?
- Should standalone work use the reusable managed workspace?
- If you want an optional backend adapter, should we configure/call it now, or only inspect readiness?
- For natural-language or LaTeX input, what statement should be considered authoritative?

Prefer asking these only after orientation. If the repository already reveals the likely next step, state the recommendation and ask for confirmation.

## Decomposition

Break large requests into small Lean targets that the coding agent can work on directly, and that Numina can run against if the optional backend path is approved. Each target should be checkable afterward with Lean/Lake commands or the helper `check` command.

For natural-language or LaTeX statements, draft the Lean declaration first and ask for confirmation before long proof work. Once the declaration is confirmed, treat statement preservation as a hard guardrail.

## Backend Run

Before any backend adapter call, state the target project/file, prompt file, max rounds, result directory, credential/proxy/MCP state, and validation plan. Ask for approval before any external model call or runtime mutation.

After the adapter returns, inspect changed Lean files, run local Lean/Lake validation, and reject results containing `sorry`, `admit`, new `axiom`, or unapproved theorem statement changes.

Backend adapters must satisfy `backend_adapter_checklist.md` before they are called.

## Iteration Policy

Stop when:

- validation succeeds without `sorry`, `admit`, or new `axiom`;
- max local iterations are reached;
- Lean workspace setup is missing or broken;
- backend adapter credentials/auth are missing and the user specifically requires that adapter;
- the remaining error requires a human mathematical decision;
- the only path forward would weaken the theorem statement without approval.

When stopping before success, reduce the problem to the smallest useful failing fragment. Use `minimize-failure` when it helps, then report exact Lean errors/goals and the next human decision needed.
