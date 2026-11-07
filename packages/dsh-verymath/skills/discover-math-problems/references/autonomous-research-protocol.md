# Autonomous Research Protocol

Use this protocol when the user has mathematical taste, a vague background, a
note bundle, or an immature theorem idea but no precise problem yet.

## Phase 1: Background Map

Extract:

- objects and structures;
- morphisms, operations, invariants, and constraints;
- toy examples and boundary cases;
- unknown definitions or ambiguous terminology;
- likely source lanes and search pivots;
- user preferences and forbidden shortcuts.

Output `background_map` with a confidence level for each item. Mark unsupported
items as speculation.

## Phase 2: Evidence Ledger

Separate:

- `source_evidence`: grounded in a cited source or user-provided artifact;
- `user_intent`: explicitly supplied by the user;
- `analogy`: plausible transfer from nearby mathematics;
- `speculation`: useful but ungrounded;
- `missing_source`: a claim that needs acquisition.

Do not let analogy or speculation become a theorem-like claim.

## Phase 3: Problem Menu

Return a ranked menu, not a single forced direction. Each item needs:

- `problem_id`
- plain-language hook
- formal candidate statement or question
- mathematical objects involved
- evidence anchors
- why it may be interesting
- likely proof route
- counterexample risk
- source acquisition needs
- suggested next action

Prefer 5 to 9 candidates. If the background is too thin, return fewer candidates
and a `no_result_recovery` section.

## Phase 4: Conjecture Lattice

For promising candidates, generate toy, weak, base, strong, and analogous
variants. Keep variants connected to the user intent and evidence ledger.

## Phase 5: Pressure Before Proof

Before proof drafting, run:

- toy-model checks;
- boundary case checks;
- counterexample search prompts;
- assumption-minimality checks;
- prior-art collision checks;
- proof-obligation extraction.

## Phase 6: Work Orders

Write bounded work orders for later coding-agent passes. Each work order needs:

- objective;
- input refs;
- expected output;
- ledger patch targets;
- acceptance criteria;
- stop conditions;
- forbidden claims.

Work orders should advance the state through evidence, critique, counterexample,
proof planning, or verification preparation. They should not mutate the state
packet directly without review.

## Phase 7: State Packet

Persist a `research_state_packet` containing current status, candidate problems,
evidence, conjectures, counterexamples, proof obligations, decisions, blocked
items, and next work orders.
