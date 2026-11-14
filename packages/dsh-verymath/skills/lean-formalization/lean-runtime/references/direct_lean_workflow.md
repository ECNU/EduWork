# Direct Coding-Agent Lean Workflow

This is the default distilled Lean-agent workflow. The coding agent reads and edits Lean directly, runs Lean/Lake checks, and iterates from concrete errors/goals. It incorporates Lean-specialist agent patterns into local work: project gating, statement normalization, theorem-state loops, premise retrieval, bounded proof attempts, failed-strategy memory, validation oracles, and minimal failure handoff. Backend adapters remain optional and adapter-first; Numina, Lean LSP/MCP, Archon, LeanCopilot, and other systems are adapter candidates, but no backend is required for ordinary Lean formalization, proof repair, or sorry completion.

## Guidance-First Loop

1. Read the user's request and classify whether this is repair, theorem formalization, proof completion, sorry completion, patch review, Numina setup/call, or output validation.
2. Inspect the target files, imports, nearby lemmas, and current Lean errors.
3. Choose the validation context: existing Lake project first, managed workspace only for standalone files.
4. For formalization, draft the Lean declaration and ask for confirmation before long proof work.
5. Build a compact local context pack from current goals, nearby proofs, relevant declarations, imports, and failed attempts.
6. Retrieve before inventing: use existing imports, nearby lemmas, local project declarations, and mathlib names before adding helper lemmas.
7. Run bounded proof attempts: make one small Lean edit or tactic route at a time, then stop and inspect feedback.
8. Run Lean/Lake validation after meaningful edits, usually `lake env lean <file>`, `lake build`, or the helper `check` command.
9. Diagnose the first concrete Lean error or unsolved goal before changing strategy.
10. Record failed routes so the agent does not cycle over the same tactic family, rewrite, or statement weakening.
11. Add helper lemmas only when they reduce proof complexity and keep theorem statements unchanged.
12. Review the final patch with direct inspection and, when useful, `review` or `detect-sorry`.
13. If blocked, use direct reduction and/or `minimize-failure` to return the smallest failing Lean fragment plus exact errors/goals and tried routes.

## When to Use Helpers

Use helpers for mechanical checks:

- environment and workspace readiness: `env`, `doctor`, `configure`;
- validation: `check`;
- safety guards: `review`, `detect-sorry`;
- failure handoff: `minimize-failure`;
- package QA: `verify-delivery`.

Do not route creative proof search through helper commands. `prove`, `formalize`, `repair`, `complete-sorries`, and `batch` only produce optional task envelopes for bookkeeping. Use the official Numina runner or Lean LSP/MCP adapter only when the optional backend path is approved and the matching adapter recipe has been reviewed.

## Workspace Choice

Prefer a user's existing Lake project when the target file is inside one. For standalone `.lean` files, use the reusable `${AI4MATH_HOME:-~/.ai4math}/lean-workspace` so Lean, Lake, and mathlib artifacts are shared across tasks and projects.

When a user project has its own `lean-toolchain` and mathlib revision, keep those versions unless the user explicitly approves a change. When creating a managed workspace, default to the AI4Math canonical toolchain `leanprover/lean4:v4.28.0` unless the user explicitly overrides it; use a versioned workspace for other standalone revisions instead of overwriting the canonical workspace.

## Good Stopping Points

Stop with success when the relevant Lean file or project validates and no unsafe placeholders remain.

Stop with a minimal failure when:

- the remaining proof step requires a human mathematical decision;
- the theorem statement appears ambiguous or unconfirmed;
- progress would require weakening a statement without approval;
- repeated local attempts are cycling over the same Lean error.
