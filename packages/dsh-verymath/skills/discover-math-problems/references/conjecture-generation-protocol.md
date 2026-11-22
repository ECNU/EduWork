# Conjecture Generation Protocol

## Conjecture Lattice

For each promising candidate, produce variants:

- `toy`: smallest nontrivial case or simplified object.
- `weak`: relaxed conclusion or stronger assumptions.
- `base`: best current theorem-shaped candidate.
- `strong`: sharper conclusion or weaker assumptions.
- `analogous`: transferred version from a neighboring domain.

Every variant must state what changed and why it may help.

## Toy Model Ladder

Run examples before proof:

1. trivial case;
2. smallest nontrivial case;
3. generic finite case or computational toy case;
4. boundary case;
5. suspected counterexample family.

Record whether each toy model supports, refines, or threatens the conjecture.

## Novelty Scan

Novelty scan is not a proof of novelty. It only checks collision risk.

Track:

- likely known theorem;
- possible folklore result;
- source lane to inspect;
- exact phrase or query seed;
- whether the candidate should pause for source acquisition.

## Failure Budget

Assign a rough failure budget:

- `0`: probably false or already contradicted.
- `1`: vague, source-poor, or mostly motivational.
- `2`: plausible but needs evidence or sharpening.
- `3`: stress-testable with clear assumptions.
- `4`: proof-sketch-ready with explicit obligations.
- `5`: verification-ready after obligations are resolved.

Do not spend long proof effort on budget `0` or `1` unless the task is to
explain failure.

## Refinement Moves

When a conjecture is weak or threatened, try:

- weaken conclusion;
- strengthen assumptions;
- restrict object class;
- add missing finiteness/regularity/hypothesis;
- replace equality with inequality, bound, or existence;
- split into lemma sequence;
- reframe as obstruction or counterexample question.
