# Agent-Mediated Proof Protocol

This protocol defines an agent-mediated generation and verification workflow as
a coding-agent artifact process. It does not require API access by default.

This protocol does not require API access by default.

## Inputs

Accept any of:

- candidate theorem statement;
- problem artifact;
- proof sketch;
- proof obligations;
- source notes;
- previous verification report;
- repair hints.

## Workflow

1. Normalize the statement, hypotheses, definitions, allowed black boxes, and
   target proof style.
2. Build `problem_intake.md` with assumptions and ambiguity notes.
3. Run the generation role to draft `proof_blueprint.md`.
4. Write `generation_trace.json` with route choices, dependencies, and known
   risks.
5. Run the verification role on the full blueprint.
6. Write `verification_report.json` with verdict fields.
7. Convert failures into `repair_hints.md` and
   `proof_obligation_patches.json`.
8. Apply the proof acceptance contract.

## Verdict Fields

Use these fields in `verification_report.json`:

- `verdict`: `correct`, `incorrect`, `incomplete`, or `uncertain`
- `critical_errors`
- `gaps`
- `unsupported_assumptions`
- `citation_or_black_box_issues`
- `repair_hints`
- `accepted_evidence`
- `next_action`

## Agent-Mediated Contract

The contract is file-based:

- input problem artifacts in;
- blueprint and traces out;
- verifier-style report out;
- repair patches back into proof obligations.

External verifier output can be added as evidence, but absence of external
verifier output means the result remains exploratory or unverified.
