# Review Checklist

Before accepting a Lean patch:

1. Run `detect-sorry` or `review`.
2. Confirm no `sorry`, `admit`, or newly introduced `axiom`.
3. Confirm theorem/lemma declarations were not weakened unless approved.
4. Run `lake env lean <file>` or `check` when available.
5. If validation fails, run `minimize-failure`.
6. Report remaining errors and exact next action.
