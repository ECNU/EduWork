---
name: latex-build-and-layout-audit
description: Use when checking LaTeX paper projects for compilation, latexmk logs, undefined references, citation issues, duplicate labels, macro/package hygiene, layout warnings, floats, arXiv, or venue compatibility.
---

# LaTeX Build And Layout Audit

Audit whether a mathematical paper can be built and submitted reliably. This
skill handles mechanical LaTeX quality, not proof correctness.

## Inputs

- Full TeX source tree, bibliography, figures, class/style files, and target
  venue or arXiv constraints.
- Optional existing PDF, `.log`, `.blg`, `.bbl`, or build command.

## Output Contract

Return:

- Build status and exact command used or recommended.
- Hard failures: fatal compile errors, undefined references/citations, duplicate
  labels, missing files, broken bibliography, or incompatible packages.
- Soft warnings: overfull/underfull boxes, float congestion, page-limit risks,
  fragile macros, and arXiv compatibility concerns.
- Submission preflight: source package portability, clean build reproducibility,
  TeX Live compatibility, required generated files, and submission manifest
  gaps.
- Patch suggestions with file path, location, rationale, and meaning-risk label.

## Workflow

1. Inspect project structure and identify the root `.tex` file.
2. Prefer `latexmk -pdf -interaction=nonstopmode -halt-on-error <root>.tex`
   when running a build is allowed.
3. Read logs for errors, warnings, references, citations, labels, and box issues.
4. Check source package portability before upload: absolute paths, local-only
   paths, spaces or fragile file names, missing style files, missing class files,
   missing bibliography files, missing figures, and case-sensitive path issues.
5. Check arXiv and venue preflight risks: TeX Live version assumptions,
   unsupported external commands, shell escape requirements, stale `.bbl`,
   figure format/engine mismatches, `\include` paths that write aux files below
   the top directory, and policy-forbidden watermarks, referee notes, or margin
   comments.
6. Produce or request a submission manifest listing root file, build command,
   engine, bibliography mode, custom `.sty/.cls/.bst` files, figures,
   supplements, code/data links, and unresolved risks.
7. Separate mechanical fixes from edits that could affect mathematical meaning.

## Preflight Checklist

- Clean build: remove generated artifacts or build in a fresh directory, run the
  stated command, and report remaining fatal errors, rerun warnings, undefined
  references/citations, duplicate labels, and `.blg` errors.
- Path hygiene: flag absolute paths, local machine paths, mixed-case includes,
  spaces in source package file names, and references to files outside the
  submission tree.
- Dependency hygiene: flag missing style/class/bibliography/figure files and
  custom macros that only exist in a local TeX installation.
- arXiv readiness: note TeX Live compatibility, `.bbl` consistency, figure
  format/engine fit, noninteractive build requirements, and source package
  completeness.
- Venue readiness: compare against the provided venue profile or checklist
  instead of guessing hidden venue requirements.

## Review Rules

- Ask before running long builds, installing TeX packages, or changing class
  files.
- Do not silence warnings by hiding content or changing math meaning.
- Treat build reproducibility as part of the paper deliverable.
- Do not turn this audit into proof review; route mathematical support issues
  to `proof-obligation-and-assumption-audit` or `claim-evidence-ledger`.
