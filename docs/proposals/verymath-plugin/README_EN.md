# VeryMath capability plugin proposal

**English** | [简体中文](README.md)

Status: the plugin is implemented and its code is submitted in this repository's `packages/` form in [#301](https://github.com/ECNU/EduWork/pull/301), a Draft awaiting review. It was previously published as the standalone package `@louisultra/dsh-verymath` on npm; on adoption it moves to the official scope following this repository's release conventions and the old package is deprecated. This proposal covers integration boundaries and verification evidence; adoption form is for the maintainers to decide.

## Goal

Bring [VeryMath](https://github.com/orgs/VeryMath/repositories)'s mathematical learning and research capabilities into EduWork as an optional DSH plugin: paper reading with theorem dependencies, a bilingual glossary, mathematical writing and slides, optimization and computation, formalization, and research workflows. Tracked by [#152](https://github.com/ECNU/EduWork/issues/152).

## Integration shape and boundaries

`packages/dsh-verymath` is a standalone package; `lib/` and `node_modules/` are not committed. It mounts optionally through `cordis.patch.yml` and does not change the distribution's default composition. The plugin integrates only through the DSH plugin API, and workspace writes use the existing sandbox authorization.

General capabilities stay inside the package; external environments are checked on demand. Python, SageMath, TeX Live, Lean/elan and MATLAB are installed by the user, return install hints when missing, and are never bundled. Sage support is documentation lookup only and runs no code. MATLAB goes through the official MathWorks MCP server and needs the user's own licence; that part sits outside the plugin API.

Structural validation covers dependency integrity, cycles and dangling links only. It does not judge whether a proof is correct, consistent with the upstream `skill_base` capability boundary.

## Licensing and provenance

The package declares `MulanPSL-2.0 AND MIT`, meaning different components carry different licenses. Original glue code is MulanPSL-2.0; skill content adapted from VeryMath stays MIT. Seven of the eight upstream repositories are MIT; the eighth, Sagemath-skill, is GPLv3 and contributes no code — only a lookup contract re-implemented in TypeScript from its public documentation.

`UPSTREAM.json` records full commits per repository, `NOTICE.md` records the scope of adaptation and per-item changes, and `LICENSING.md` maps paths to licenses. Beamer templates only reference themes from the user's own TeX Live; no third-party style files or fonts are redistributed.

## Verification and evidence

1. The plugin installs, enables and removes through the official plugin mechanism, verified locally by loading the tarball into a clean DSH environment.
2. Task chains complete and artifacts land in the session workspace for follow-up work: paper structure extraction, QP solving, OCR proofreading, Beamer compilation and MATLAB execution all have real run records.
3. Scripts and templates ship with the skills and are actually callable: upstream Python scripts are included verbatim, and the 9 offline test suites across the 8 upstream repositories (201 tests) pass.
4. Missing dependencies return structured hints instead of crashing: four probe tools for Python, Sage, Beamer and OSQP, plus a Lean forbidden-token scan that needs no toolchain.
5. The package's own 102 vitest tests and the runtime probe (real DSH plugin API, no model calls) pass.

Scenario examples for every capability are in [capability-examples.md](capability-examples.md), following the five-field structure the reviewers asked for: who and when, a copy-paste prompt, public sample input, expected output with completion criteria, and run conditions with verification status. All 14 capabilities are covered; scenarios needing MATLAB or Sage execution are marked as requiring the user's own environment and as not reproducible in CI.

## Adoption and open items

Three paths are open to the maintainers: list the community plugin in the documentation, recommend it in the distribution configuration, or vendor it into this repository as in #301 and move the scope. For the third, these need to be settled first: plugin directory and package name, who runs the `@eduwork` publish, whether examples live in the package or the repository docs, when the old package is deprecated, how the commit history is merged, and which documentation copy becomes authoritative afterwards.

Windows is untested, including path and binary discovery for external environments on that platform.
