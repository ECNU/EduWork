---
name: discover-math-problems
description: "Use when Codex should turn fuzzy mathematical background, scattered notes, domain intuition, failed proof attempts, immature theorem ideas, or extremal graph questions needing variants into ranked candidate problems, a conjecture lattice, evidence ledger, counterexample pressure, proof obligations, work orders, and a resumable research_state_packet. Use before theorem proving or formal verification when the user does not yet know which mathematical problem should be pursued."
---

# Discover Math Problems

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；纯方法论，零外部依赖。
- 状态纪律（"Never call a conjecture a theorem"）在 DSH 会话中继续生效；
  研究状态包（research_state_packet）与 work_orders 写入当前会话工作区。
- 问题发现后需要形式化验证时，路由到 lean-formalization 技能；写成论文时路由到 paper-writing。


This file is the shared Skill layer for the mathematical problem discovery and
conjecture-generation package. Keep platform adapters thin and route durable
research behavior back here and to the `references/` protocol files.

## Core Stance

Act as a coding-agent research coordinator, not a passive CLI runner. Read the
user's mathematical background, inspect any local notes or source artifacts,
generate candidate research directions, pressure-test them, and write durable
artifacts that another coding agent can resume.

Reply to the user in Simplified Chinese by default. Keep artifact names, JSON
keys, theorem labels, commands, file paths, and status labels in English.

## First Move

If the user gives fuzzy background, start immediately by building a minimal
research state. Ask at most one blocking clarification question; otherwise make
a bounded autonomous move and report the artifacts created or updated.

Use this visible loop:

1. Extract background objects, definitions, examples, unknowns, and source leads.
2. Build or update the evidence ledger.
3. Produce a ranked `problem_menu`.
4. Build a `conjecture_lattice` for promising candidates.
5. Apply toy-model tests, counterexample pressure, novelty collision checks, and
   assumption-boundary checks.
6. Write explicit `proof_obligations`.
7. Prepare bounded `work_orders` for follow-up coding-agent passes.
8. Save a resumable `research_state_packet`.

## Status Discipline

Use strict status labels:

- `background_map`
- `candidate_problem_menu`
- `candidate_conjecture`
- `stress_tested_conjecture`
- `proof_obligations_ready`
- `verification_ready`

`verification_ready` means ready for verification work, not already verified.
Never call a conjecture a theorem. Never call a proof sketch verified. Keep
external proof-tool execution outside this skill's status ladder.

This skill does not run verifier agents or external proof tools.
Do not set up external provers from this discovery workflow.

## Artifact Contract

Write durable artifacts whenever the task is more than a quick conversation:

- `background_map.md` and `background_map.json`
- `problem_menu.md` and `problem_menu.json`
- `conjecture_lattice.md` and `conjecture_lattice.json`
- `evidence_ledger.json`
- `counterexample_pressure.md`
- `proof_obligations.md` and `proof_obligations.json`
- `work_orders.md` and `work_orders.json`
- `research_state_packet.json`
- `human_decision_brief.md`

For detailed schemas and minimum fields, read
`references/artifact-contract.md`.

## Reference Routing

- For Turán-type or extremal graph problem variants, read
  `references/extremal-graph-variants.md` before generating the problem menu.
  Use its variation checklist with this skill's existing literature checks
  and candidate ranking; retain the user's requested scope and output length.
- For the end-to-end autonomous research loop, read
  `references/autonomous-research-protocol.md`.
- For conjecture lattice, toy model, novelty scan, and failure budget rules,
  read `references/conjecture-generation-protocol.md`.
- For artifact names, JSON keys, status transitions, and handoff expectations,
  read `references/artifact-contract.md`.

## Human Intervention

Continue autonomously unless a choice changes the mathematical intent. Ask the
user before:

- changing the problem domain or central object;
- accepting a strong external theorem as a black box;
- discarding the user's preferred direction;
- spending a long run on source acquisition or computational search;
- promoting `stress_tested_conjecture` to `verification_ready`.

## Failure Modes

- If sources are missing, label claims as speculation and create source-search
  work orders.
- If candidates are too vague, weaken them into toy/base/strong variants.
- If counterexample pressure is high, do not hide it; record the pressure and
  propose refinements.
- If no good problem appears, return a `no_result_recovery` section with next
  query ladders and one focused user question.
