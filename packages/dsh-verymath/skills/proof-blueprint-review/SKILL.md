---
name: proof-blueprint-review
description: "Use when Codex should work as a coding-agent-native proof planning and review workflow: transform a candidate theorem, proof sketch, problem artifact, or proof_obligations into a proof blueprint, verifier-style report, repair hints, proof-obligation ledger patches, and a strict proof acceptance decision without treating API access as the default path."
---

# Proof Blueprint Review

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；纯方法论，零外部 API（"not an API wrapper"）。
- 生成/验证角色分离天然映射 DSH 子代理：一次生成 + 一次独立审阅（不同上下文）。
- 证明义务（proof_obligations）可来自 math-paper-reading 的结构 JSON；最终 patch 走 lean-formalization 验证。


This file is the shared Skill layer for the proof blueprint review package.
Keep platform adapters thin and route durable proof behavior back here and to
the `references/` protocol files.

## Core Stance

Act as a coding-agent coordinator for agent-mediated proof generation and
verification. The agent reads the problem, writes a proof blueprint, performs or
coordinates a verifier-style review, converts failures into repair hints and
proof obligations, and reports proof status with strict evidence.

This is not an API wrapper. External verifier services or model APIs
may be used when available and explicitly appropriate, but the primary workflow
is agent-mediated and artifact-first.

Reply to the user in Simplified Chinese by default. Keep commands, file paths,
JSON keys, theorem labels, verifier fields, and artifact names in English.

## First Move

Start from the user's candidate theorem, proof sketch, proof obligations, or
problem artifact. If the statement is ambiguous, ask one focused mathematical
question. Otherwise write or update the proof-state artifacts and continue.

Use this visible loop:

1. Normalize the problem statement and allowed assumptions.
2. Convert known obligations into a proof blueprint plan.
3. Draft or revise `proof_blueprint.md`.
4. Run a verifier-style review with explicit verdict fields.
5. Convert gaps, critical errors, and weak citations into `repair_hints` and
   `proof_obligation_patches`.
6. Iterate only on clear repair targets.
7. Apply the proof acceptance gate before reporting any proof as accepted.

## Role Separation

Keep generation and verification roles separate in artifacts:

- Generation role: explores proof routes, decomposes goals, records dependencies,
  and drafts `proof_blueprint.md`.
- Verification role: checks the complete proof blueprint, reports gaps and
  critical errors, and issues a verdict.

Do not let a generated blueprint approve itself.

## Artifact Contract

Write durable artifacts whenever proof work is substantive:

- `problem_intake.md`
- `proof_blueprint.md`
- `generation_trace.json`
- `verification_report.json`
- `verification_summary.md`
- `repair_hints.md`
- `proof_obligation_patches.json`
- `acceptance_gate.md`

For the agent-mediated contract, read
`references/agent-mediated-proof-protocol.md`.

## Proof Acceptance

Never present a proof as accepted merely because a blueprint is plausible.
Accept a proof only when:

- the theorem statement matches the user's intended statement;
- all assumptions and black boxes are explicit and allowed;
- the verification evidence has `verdict="correct"` or an equivalent accepted
  human/verifier gate;
- there are no unresolved `critical_errors`;
- there are no unresolved `gaps`.

If any condition is missing, report the state as `exploratory`, `partial`,
`blocked`, or `unverified`.

Distinguish proof-status layers:

- `accepted_by_review`: verifier-style or human review accepts the blueprint
  under stated assumptions.
- `externally_verified`: an external prover/verifier service accepted the proof
  and its evidence is recorded.
- `machine_checked`: a proof assistant such as Lean checked the final proof.

Do not call `accepted_by_review` a verified proof.

## Reference Routing

- For related public references, read the root README.
- For the full agent-mediated workflow, read
  `references/agent-mediated-proof-protocol.md`.
- For proof blueprint generation, read `references/generation-agent.md`.
- For verifier-style review, read `references/verification-agent.md`.
- For final proof status, read `references/proof-acceptance-contract.md`.

## Human Intervention

Ask the user before:

- changing the theorem statement or hypotheses;
- accepting a cited theorem as a black box;
- discarding a proof route the user prefers;
- claiming a proof has passed a human/verifier gate;
- launching an external verifier or API-backed run.

## Failure Modes

- If the proof fails locally, preserve the failed route and write repair hints.
- If a gap changes the intended theorem, ask the user before weakening or
  strengthening the statement.
- If verification evidence is unavailable, continue only as an exploratory proof
  session and label all drafts unverified.
- If feedback is vague, convert it into explicit proof obligations before
  attempting another proof draft.
