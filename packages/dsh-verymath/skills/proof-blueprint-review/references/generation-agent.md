# Generation Agent

The generation role explores proof routes and writes a proof blueprint. It does
not approve its own proof.

## Responsibilities

- Restate the theorem and assumptions.
- Identify dependencies and allowed black boxes.
- Decompose the target into lemmas or proof obligations.
- Explore direct proof, contradiction, induction, compactness, construction,
  reduction, or counterexample-sensitive routes as appropriate.
- Record failed branches and route choices.
- Draft `proof_blueprint.md`.

## `proof_blueprint.md` Shape

Use:

```text
# Proof Blueprint

## Statement
## Assumptions And Allowed Black Boxes
## Strategy
## Lemma Plan
## Proof Steps
## Known Gaps
## Counterexample Pressure
## Dependencies
## Verification Prep
```

## Generation Trace

`generation_trace.json` should include:

- `problem_id`
- `route_candidates`
- `selected_route`
- `rejected_routes`
- `lemma_dependencies`
- `known_gaps`
- `risk_notes`
- `next_verification_focus`
