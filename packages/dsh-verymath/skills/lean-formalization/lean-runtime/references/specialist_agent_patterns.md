# Lean-Specialist Agent Pattern Integration

This reference explains how the coding-agent-first skill incorporates publicly documented Lean-specialist agent designs without making any external agent mandatory. Preserve the mechanism, not prompts, benchmark-specific assumptions, or private implementation details. For the capability-by-capability distillation contract, read `lean_agent_capability_map.md`; for Lean LSP/MCP setup and tool policy, read `lean_lsp_mcp_adapter.md`.

## Source Families

- Numina-style coding-agent orchestration: project setup, official runner calls, Claude/MCP/tool integration, bounded external proof attempts, and local Lean validation.
- LeanDojo/ReProver-style loops: theorem state as the central object, premise retrieval, tactic generation, execution feedback, and proof search evaluation.
- LeanCopilot-style assistance: programmatic tactic, premise, and proof-search hooks that a human/coding agent can treat as optional suggestions.
- COPRA-style proof search: stateful attempts, backtracking, failed-strategy memory, and compact proof-state reporting.
- Lean LSP/MCP-style integration: editor/server feedback, goal inspection, diagnostics, and tool scope tied to the target project.
- Lightweight iterative agents: small edit/check loops, local context retrieval, and explicit stop conditions.

These sources provide patterns to adapt and integrate. Do not claim parity with a specialist prover unless the original backend is actually called and validated.

Public source anchors:

- Numina Lean Agent: `https://github.com/project-numina/numina-lean-agent`
- LeanDojo/ReProver: `https://github.com/lean-dojo/LeanDojo`
- LeanCopilot: `https://github.com/lean-dojo/LeanCopilot`
- COPRA: `https://github.com/trishullab/copra`

## Integrated Default Workflow

1. Gate the project: identify the Lake root, toolchain, mathlib revision, imports, and build status before proof work.
2. Normalize the target: locate the authoritative theorem statement, declaration name, hypotheses, namespace, and allowed statement changes.
3. Build a local context pack: nearby lemmas, imported modules, relevant declarations from `rg`, current goals, and prior failed attempts.
4. Run the theorem-state loop: make one small edit, run Lean, read the first concrete error or goal, update the context pack, and continue.
5. Use bounded search: try a small number of plausible tactic/proof routes; record failed routes so the agent does not cycle.
6. Retrieve before inventing: search existing project/mathlib names and nearby proofs before adding helper lemmas.
7. Validate as oracle: Lean/Lake success is required; final patches must not contain `sorry`, `admit`, new `axiom`, or unapproved statement drift.
8. Escalate deliberately: call a documented backend adapter only after that adapter has an explicit contract and validation gates, and only after explaining target, credentials/proxy/MCP state, result directory, and validation plan.
9. Hand off minimally: when blocked, return the smallest failing Lean fragment, exact goals/errors, tried routes, and the next mathematical decision.

## Pattern Map

| Specialist mechanism | Coding-agent integration |
| --- | --- |
| Runtime/environment gate | `env`, `doctor`, `configure`, direct Lake root inspection |
| Theorem-state centered search | Lean error/goal loop after each small edit |
| Premise retrieval | `rg`, nearby imports/proofs, project declarations, optional external search |
| Bounded proof attempts | `max_rounds`, local iteration caps, failed-strategy notes |
| Backtracking/failure memory | Record tried tactic families and rejected statement changes |
| Lean LSP/MCP goal tooling | Optional adapter recipe for goal state, diagnostics, hover, local search, external search, and multi-attempt screening |
| Lean-specialist backend adapter | Adapter-first optional escalation; Numina, Lean LSP/MCP, Archon, and LeanCopilot are adapter candidates, never required for default work |
| Validation oracle | Lean/Lake plus `review` and `detect-sorry` |
| Failure artifact | `minimize-failure` and exact errors/goals |

## Escalation Rule

Default to integrated local patterns. Escalate to a real specialist backend only when:

- the user asks for Numina, official Lean Agent, batch proof search, or an approved external subagent;
- local bounded attempts are cycling and the user approves a backend call;
- the required credentials, proxy, MCP scope, and target project are understood;
- all backend output will still be reviewed and checked locally.

## Anti-Patterns

- Do not replace proof work with a CLI workflow that only asks the user for more input.
- Do not treat a missing Numina key or backend adapter as blocking ordinary coding-agent Lean work.
- Do not copy upstream prompts or claim hidden benchmark behavior.
- Do not add helper lemmas or theorem statement changes just to make a proof easier unless the user approves.
- Do not let an external backend output bypass local Lean validation and patch review.
- Do not call a backend adapter unless its setup, call, credential, mutation, and validation contracts are documented.
