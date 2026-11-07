# Distilled Lean-Agent Capability Map

This reference is the contract for "distilling Lean agent ability" into the
AI4Math Lean skills. It separates three layers:

- `distilled default`: implemented as the normal coding-agent workflow without
  external APIs or backend services;
- `adapter_recipe`: documented for explicit user-approved escalation, then
  locally validated before acceptance;
- `not claimed`: related work that is cited as inspiration only.

Use "adapter recipe" in prose and `adapter_recipe` as the machine-readable
support status.

Do not claim parity with a specialist Lean prover unless the original backend
is actually configured, called, and its output is validated locally.

This is the distilled Lean-agent capability layer for the default skill path:
project gate, statement normalization, local context pack,
retrieve-before-inventing, bounded proof attempts, failed-route memory, local
validation, and minimal failure handoff.

## Public Source Anchors

- Numina Lean Agent: https://github.com/project-numina/numina-lean-agent
  - Public README describes an agent built on Claude Code for formal theorem
    proving tasks, with tutorial setup, CLI skills, result directories, and
    credentialed model/tool calls.
- project-numina/lean-lsp-mcp: https://github.com/project-numina/lean-lsp-mcp
  - Public README describes an MCP server over Lean LSP with diagnostics, goal
    states, hover information, local search, external theorem search, code
    running, multi-attempt screening, and project build tools.
- LeanDojo / ReProver: https://leandojo.org/leandojo.html and
  https://github.com/lean-dojo/ReProver
  - Public materials describe retrieval-augmented theorem proving and
    best-first search with a tactic generator.
- LeanCopilot: https://github.com/lean-dojo/LeanCopilot
  - Public README describes native Lean tactics for tactic suggestion, proof
    search, premise selection, and running LLMs from Lean.
- COPRA: https://github.com/trishullab/copra
  - Public README describes an in-context proof agent for formal theorem
    proving, with Lean setup, CLI use, experiments, and parallel theorem runs.

These sources are used to extract mechanisms. Do not copy private prompts,
benchmark-specific assumptions, or upstream implementation details.

## Capability Status

| Capability | Source family | AI4Math status | Evidence or hook |
| --- | --- | --- | --- |
| Project gate: find Lake root, toolchain, mathlib revision, imports, build state | Numina, Lean LSP/MCP, LeanDojo | distilled default | `env`, `doctor`, `check`, direct Lake inspection |
| Statement normalization and preservation | Numina, COPRA, local coding-agent review | distilled default | `lean-formalization` playbook and `review` statement-drift guard |
| Theorem-state loop from concrete Lean errors/goals | LeanDojo/ReProver, Lean LSP/MCP, COPRA | distilled default | direct edit/check loop; optional MCP goal tools when approved |
| Local context pack: imports, nearby proofs, project declarations, failed attempts | LeanDojo/ReProver, Numina, LeanCopilot | distilled default | `rg`, nearby proof inspection, failed-strategy notes |
| Premise retrieval before invention | LeanDojo/ReProver, LeanCopilot, Lean LSP/MCP | distilled default plus `adapter_recipe` | local `rg`; optional `lean_local_search`, `lean_leansearch`, `lean_loogle`, `lean_state_search` through MCP |
| Bounded tactic/proof attempts | COPRA, LeanDojo/ReProver, LeanCopilot, Lean LSP/MCP | distilled default plus `adapter_recipe` | local iteration caps; optional `lean_multi_attempt` through MCP |
| External proof-search orchestration | Numina, COPRA | `built_in_recipe` or `adapter_recipe` | built-in Numina adapter; other backends follow `backend_adapter_checklist.md` |
| Native Lean tactic suggestion / proof search | LeanCopilot | adapter candidate | cite or use only when the target project imports/configures LeanCopilot |
| Lean LSP goal, hover, diagnostics, completions, declaration lookup | Lean LSP/MCP | `adapter_recipe` | `lean_lsp_mcp_adapter.md` |
| Semantic/external theorem search | Numina, Lean LSP/MCP, LeanDojo ecosystem | `adapter_recipe` | MCP external search tools or backend-specific skill keys after approval |
| Result directory, round limits, and run artifacts | Numina, COPRA | `built_in_recipe` or `adapter_recipe` | Numina runtime recipe and backend adapter checklist |
| Validation oracle | Lean itself, all source families | distilled default | `lake env lean`, `lake build`, `check`, `detect-sorry`, `review` |
| Minimal failure handoff | local skill design, COPRA-style stop condition | distilled default | `minimize-failure`, exact errors/goals, tried routes |

## Distilled Default Loop

The default AI4Math Lean worker should behave like a distilled Lean agent even
when no backend or MCP server is configured:

1. Gate the project: identify project root, toolchain, mathlib revision, imports,
   and whether the target builds.
2. Normalize the target: locate the authoritative statement, declaration name,
   namespace, hypotheses, and whether statement changes are allowed.
3. Build the context pack: current error/goal, nearby proofs, imported modules,
   project declarations, relevant mathlib names, and tried routes.
4. Retrieve before inventing: search local project and imports first; only add
   helper lemmas after checking nearby/API-compatible declarations.
5. Attempt bounded proof steps: try one small edit or tactic route at a time,
   then run Lean and read the first concrete diagnostic.
6. Record failed routes: do not cycle over the same tactic family, rewrite, or
   statement weakening.
7. Validate locally: final output must pass Lean/Lake checks and patch safety
   guards.
8. Hand off minimally when blocked: return the smallest failing Lean fragment,
   exact goals/errors, tried routes, and the next mathematical decision.

## Adapter Escalation

Escalate only when the user asks for Numina, official Lean Agent, Lean LSP/MCP,
Archon, LeanCopilot, batch proof search, or another external backend, or when
local bounded attempts are cycling and the user approves escalation.

Before escalation, document:

- target Lake project/file/folder;
- backend source and support status;
- setup location and network access;
- credentials, API keys, proxy, and MCP scope;
- command or MCP server configuration;
- mutation boundary and result directory;
- local validation gate and failure fallback.

The adapter result is only a proposal until local Lean/Lake validation and patch
review pass.

## Acceptance Tests For This Skill

A delivery claiming Lean-agent capability distillation must include:

- this capability map;
- a Lean LSP/MCP `adapter_recipe`;
- `lean-formalization` text that names the distilled default loop, not only
  related work;
- `verify-delivery` checks that require these references;
- at least one package-level test that fails if the distilled capability
  references are removed.
