---
name: proof-obligation-and-assumption-audit
description: Use when checking mathematical paper results for assumptions, quantifiers, domains, dependency fit, edge cases, external theorem use, proof coverage, or theorem-to-claim consistency.
---

# Proof Obligation And Assumption Audit

Audit whether a mathematical result is supported by its stated assumptions,
dependencies, and proof coverage. This is a writing review, not automated
theorem proving: it identifies obligations and risks that paper prose must not
hide.

## Inputs

- Theorem, proposition, lemma, corollary, algorithm guarantee, or experiment
  claim under review.
- Proof sketch or proof text, definitions, notation ledger, cited external
  results, and relevant source notes.
- Optional venue standards or reviewer comments.

If proof material is unavailable, mark the result provisional instead of
rewriting it as proved.

## Output Contract

Return a proof-obligation table with:

| Field | Meaning |
| --- | --- |
| `result` | The theorem, lemma, proposition, or claim under review |
| `assumptions` | Quantifiers, domains, regularity, constraints, and boundary conditions |
| `dependencies` | Definitions, previous results, external theorems, experiments, or algorithms used |
| `obligation` | What the proof must establish or verify |
| `coverage` | `covered`, `partial`, `missing`, `conflicting`, or `unclear` |
| `risk` | Meaning-preserving issue, missing case, overclaim, citation-fit risk, or notation risk |
| `action` | Keep, soften, split, add assumption, cite precisely, prove, verify, or ask human |

## Workflow

1. Restate the result with all quantifiers, domains, and assumptions visible.
2. List proof obligations: existence, uniqueness, invariance, convergence,
   optimality, bounds, limiting cases, case splits, and dependency conditions.
3. Check every cited external theorem against its original assumptions and
   conclusion strength when sources are available.
4. Compare proof coverage to obligations; mark missing or partial cases without
   patching the mathematics.
5. Suggest wording changes only when they preserve the verified mathematical
   meaning.

## Review Rules

- Do not strengthen a theorem to match the desired contribution.
- Do not weaken or drop assumptions without checking proof dependencies.
- Keep empirical evidence, heuristic arguments, conjectures, and formal proof
  status separate.
- Route notation conflicts to `notation-and-variable-consistency` before making
  semantic judgments that depend on symbols or dimensions.
