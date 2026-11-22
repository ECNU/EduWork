---
name: paper-skeleton-and-logical-architecture
description: Use when turning mathematical notes, theorem statements, proof sketches, experiments, or reading outputs into a paper skeleton, section plan, result dependency map, or contribution architecture before prose drafting.
---

# Paper Skeleton And Logical Architecture

Build the paper's mathematical architecture before polishing prose. The goal is
to make definitions, results, dependencies, proof placeholders, examples, and
section roles visible early enough to catch gaps.

## Inputs

- Source packet: definitions, theorem statements, lemmas, proof sketches,
  experiment logs, figures, reading notes, and intended target venue.
- Optional existing outline, draft, reviewer comments, or page constraints.

If the source packet is missing, request it or produce only a checklist of
materials needed for a skeleton.

## Output Contract

Return:

- Paper skeleton: section order, purpose of each section, and expected inputs.
- Result dependency map: definitions, assumptions, lemmas, propositions,
  theorems, corollaries, algorithms, experiments, and figures.
- Gap list: missing definitions, missing proof sketches, unsupported examples,
  unplaced results, circular dependencies, and intro/abstract claims that do not
  match the technical core.
- Drafting plan: what can be written now, what needs proof/citation/experiment
  evidence first, and which subskill should run next.

## Workflow

1. Inventory source materials before writing.
2. Identify the main result, supporting results, and reader prerequisites.
3. Build a dependency map from definitions to claims and from claims to proof or
   empirical support.
4. Assign each section a job: motivation, background, setup, main result, proof,
   examples, experiments, limitations, or conclusion.
5. Mark placeholders explicitly; do not fill missing proofs, citations, or
   experiments with plausible prose.
6. Route theorem-risk items to `proof-obligation-and-assumption-audit` and
   support-risk items to `claim-evidence-ledger`.

## Review Rules

- Prefer a sparse skeleton over fluent prose when dependencies are unclear.
- Keep introduction, abstract, and conclusion claims weaker than or equal to the
  verified technical results.
- Do not add new mathematical claims to make the story smoother.
- Treat examples and experiments as structural evidence only after their source
  logs or statements are present.
