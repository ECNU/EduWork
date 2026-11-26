# Proof Acceptance Contract

Accepting a proof is a gated decision, not a tone choice.

## Accepted Proof Conditions

A proof may be reported as accepted only when all conditions hold:

- the theorem statement matches the user's intended statement;
- all assumptions are explicit;
- all black boxes are allowed and sufficient;
- verification evidence reports `verdict="correct"` or an equivalent accepted
  human/verifier gate;
- `critical_errors` is empty;
- `gaps` is empty;
- unresolved counterexample pressure is absent or explicitly discharged.

## Non-Accepted Status Labels

Use one of:

- `exploratory`
- `partial`
- `blocked`
- `unverified`
- `needs_human_decision`

## Repair Patches

Convert verifier feedback into proof obligations:

- `patch_id`
- `source`: `verifier_feedback` or external verifier source
- `candidate_problem_id`
- `obligation`
- `status`: usually `open`
- `repair_hint`
- `next_action`

Do not silently mutate the theorem statement to make a proof pass. Ask the user
before weakening or strengthening the statement.
