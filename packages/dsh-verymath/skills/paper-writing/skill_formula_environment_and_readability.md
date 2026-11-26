---
name: formula-environment-and-readability
description: Use when improving mathematical formulas, displayed derivations, theorem/proof environments, equation alignment, cases blocks, long displays, or formula-to-prose readability in paper drafts.
---

# Formula Environment And Readability

Improve displayed mathematics so formulas communicate the argument. Environment
choice is part of exposition: it should reveal structure without changing
meaning.

## Inputs

- TeX or draft text containing formulas, theorem statements, proofs, algorithms,
  or derivations.
- Optional venue class constraints and style preferences.

## Output Contract

Return:

- Formula findings: location, issue, proposed environment or rewrite, and
  meaning-risk level.
- Revised snippets for high-value displays.
- Notes where a formula requires a correctness or notation audit before rewrite.

## Workflow

1. Identify long, dense, or ambiguous displayed formulas.
2. Check whether the surrounding prose states what the formula does.
3. Choose environments by role: `equation` for a single object, `align` for
   aligned derivations, `split` for one numbered multi-line equation,
   `multline` for long expressions, and `cases` for piecewise definitions.
4. Remove brittle manual spacing and avoid `eqnarray` and raw `$$`.
5. Preserve labels, numbering intent, punctuation, and mathematical meaning.

## Review Rules

- Do not make formulas shorter by deleting assumptions, quantifiers, or terms.
- Flag a displayed formula when the prose and formula disagree.
- Prefer readability over clever compression in proof-critical derivations.
