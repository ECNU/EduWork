# Failure Taxonomy

Use these categories in result JSON and summaries:

- `missing_lean_project`: target is not inside a Lake project and no managed workspace is available.
- `lean_workspace_setup_failed`: creating or building the reusable managed workspace failed.
- `lean_build_failed`: `lake build` failed for the target project or managed workspace.
- `lean_file_failed`: single-file Lean validation failed.
- `target_missing`: requested Lean file or folder does not exist.
- `statement_ambiguous`: natural-language theorem needs user confirmation.
- `statement_unconfirmed`: long proof work should wait until the user confirms the Lean declaration.
- `statement_changed`: patch changed the theorem statement without approval.
- `unsafe_patch`: patch introduced `sorry`, `admit`, or `axiom`.
- `proof_budget_exhausted`: max local iterations reached with remaining goals.
- `human_math_decision_needed`: remaining step needs a mathematical lemma or strategy decision.

This direct skill should not report Numina, model, API-key, Claude-login, or external-backend failures because those are not runtime dependencies.
