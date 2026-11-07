# Verification Agent

The verification role checks a complete proof blueprint or proof draft. It must
be stricter than the generation role.

## Review Steps

1. Check statement consistency.
2. Check every hypothesis is used legally.
3. Check every cited black box is allowed and sufficient.
4. Check each proof step follows from prior steps.
5. Look for hidden compactness, regularity, finiteness, measurability,
   uniqueness, or boundary assumptions.
6. Identify counterexample pressure.
7. Return a verdict and repair hints.

## Report Shape

`verification_report.json` should include:

- `verdict`
- `critical_errors`
- `gaps`
- `unsupported_assumptions`
- `citation_or_black_box_issues`
- `counterexample_pressure`
- `repair_hints`
- `accepted_evidence`
- `next_action`

## Strictness

If the proof is plausible but missing a lemma, use `verdict="incomplete"`.
If a core step is wrong, use `verdict="incorrect"`.
If the proof may be right but evidence is insufficient, use
`verdict="uncertain"`.
Only use `verdict="correct"` when every acceptance condition is met.
