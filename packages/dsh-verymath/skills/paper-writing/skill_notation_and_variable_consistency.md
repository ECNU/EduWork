---
name: notation-and-variable-consistency
description: Use when checking mathematical paper drafts for notation drift, variable reuse, undefined symbols, inconsistent domains, index conventions, or scalar/vector/matrix ambiguity.
---

# Notation And Variable Consistency

Maintain a symbol ledger so notation supports comprehension and does not hide
mathematical errors.

## Inputs

- Full draft or selected sections in TeX, Markdown, or plain text.
- Definitions, theorem statements, proof notes, and formula-heavy sections.
- Optional notation conventions from the target venue or research group.

## Output Contract

Return:

- Symbol ledger: symbol, first definition, type/domain, scope, dimensions, and
  where it is reused.
- Drift report: overloaded symbols, undefined symbols, renamed objects, index
  changes, and conflicting conventions.
- Patch suggestions: concrete text or TeX edits with meaning-preservation notes.

## Workflow

1. Scan definitions, theorem statements, algorithms, equations, proofs, and
   figures for symbols.
2. Record first-use locations and expected mathematical roles.
3. Compare later uses against the ledger.
4. Flag domain, dimension, index, and notation conflicts.
5. Propose minimal renaming or clarification edits.

## Review Rules

- Do not rename symbols globally without checking proof dependencies.
- Treat variable alignment as semantic, not cosmetic, when it affects indexing,
  dimensions, or object identity.
- Preserve common field conventions such as `n`, `d`, `x`, `X`, `A`, `\epsilon`,
  and `\delta` unless the draft uses them inconsistently.
