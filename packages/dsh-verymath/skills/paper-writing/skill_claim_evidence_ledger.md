---
name: claim-evidence-ledger
description: Use when auditing mathematical paper drafts for supported claims, missing citations, overclaims, proof status, experiment support, or source-to-text traceability.
---

# Claim Evidence Ledger

Build a claim ledger before polishing prose. The goal is to make every
substantive statement traceable to a proof, experiment, citation, or explicit
uncertainty.

## Inputs

- Paper draft or target section.
- Source packet: theorem statements, proof notes, experiment logs, figures,
  bibliography, related-work notes, reviewer comments, or prior drafts.
- Optional venue/audience constraints and citation policy.

If sources are missing, request the source packet or produce only an evidence
request.

## Output Contract

Return a table with:

| Field | Meaning |
| --- | --- |
| `claim` | The exact or paraphrased paper claim |
| `location` | Section, paragraph, theorem, figure, or equation |
| `type` | `theorem`, `proof`, `experiment`, `citation`, `positioning`, `limitation`, `future-work` |
| `support` | Source file, theorem, log, citation key, or reviewer comment |
| `status` | `supported`, `citation-needed`, `needs-proof`, `needs-experiment`, `overclaimed`, `unsupported`, `uncertain` |
| `action` | Keep, cite, soften, remove, verify, or ask human |

## Workflow

1. Extract claims from the target text.
2. Classify each claim by mathematical, empirical, literature, or contribution
   role.
3. Match claims to source evidence.
4. For mathematical claims, distinguish "has a proof sketch" from "assumptions,
   dependencies, and proof obligations have been audited"; route the latter to
   `proof-obligation-and-assumption-audit` when needed.
5. Mark unsupported claims instead of rewriting them as if they were true.
6. Suggest edits that preserve the strongest source-backed version.

## Review Rules

- Do not invent citation keys, theorem numbers, experiments, or author claims.
- Keep theorem/proof status distinct from conjecture, heuristic, or empirical
  evidence.
- Do not mark a theorem claim fully supported when assumptions, dependency fit,
  or edge cases are still unaudited.
- Treat abstract, introduction, and conclusion claims as high risk because they
  compress and often overstate results.
