# VeryMath Capability Plugin Proposal (dsh-verymath)

> This is a proposal, not a description of a shipped feature or an officially supported configuration. It corresponds to [ECNU/EduWork#152](https://github.com/ECNU/EduWork/issues/152) and describes an implemented community plugin prototype and its integration boundary, for maintainers to decide whether and how to adopt it.

**English** | [简体中文](README.md)

## Goal

Bring VeryMath's mathematical learning and research capabilities into EduWork as an optional DSH plugin: mathematical paper reading, bilingual glossary, writing and optimization, computation and formalization, and research workflows.

- The plugin is implemented and published independently: [`@louisultra/dsh-verymath`](https://github.com/LouisUltra/dsh-verymath) (npm, MIT)
- This proposal states compatibility boundaries, acceptance criteria, and verification evidence; the adoption path (documentation listing / dependency recommendation / deeper integration) is the maintainer's call

## Integration shape

| Item | Content |
| --- | --- |
| Plugin name | `@louisultra/dsh-verymath` (personal npm scope; can be renamed or vendored if adopted officially) |
| Version | 0.3.1 |
| License | MIT (package); skill content and scripts adapted from VeryMath's MIT projects, source commits recorded in the in-package `UPSTREAM.json`; the SageMath corpus (CC BY-SA) is distributed separately |
| DSH compat | 0.2.x (from 0.2.0-rc.1), load-tested on EduWork 0.4.3 |
| Platform | macOS (Apple Silicon) verified; Windows expected to work (requires Node and Python on PATH) but is not yet tested |

## Capability list

**14 model tools**: glossary query/upsert/build (`verymath_glossary_query/upsert/build`), environment probes for Python/Sage/Beamer/OSQP (`verymath_python_check`, `verymath_sage_check`, `verymath_beamer_check`, `verymath_osqp_check`), QP solving with independent KKT verification (`verymath_osqp_solve`), paper structure validation (`verymath_paper_validate`), paper dependency-graph engine (`verymath_paper_graph`), OCR error-candidate locator (`verymath_ocr_scan`), Lean forbidden-token scan (`verymath_lean_detect_sorry`, no Lean toolchain required), anti-hallucination Sage corpus search (`verymath_sage_search`), research workspace gate validation (`verymath_research_gate`).

**16 bundled skills** (registered into the DSH skill catalog through the plugin's skill provider): `math-glossary`, `math-paper-reading`, `graph-theory-paper-reading`, `after-ocr`, `paper-writing`, `math-beamer`, `discover-math-problems`, `proof-blueprint-review`, `open-problem-research-pipeline`, `least-squares`, `invariant-computation`, `mixed-integer-programming`, `osqp-solver`, `lean-formalization`, `lean-setup`, `matlab-runner`.

## Compatibility boundaries

- **No EduWork public-interface changes**: the plugin integrates only through the DSH plugin API (tool registration, skill registration, fs service); workspace writes go through the existing sandbox authorization — no new permission surface.
- **External environments checked on demand**: Python/Sage/TeX/Lean/MATLAB are user-installed; the plugin probes and surfaces missing-dependency hints, never auto-installs or bundles heavy dependencies (Sage corpus lives separately at `~/.verymath/sagemath-corpus`; MATLAB via the official MathWorks MCP server).
- **License isolation**: the Sagemath-skill package itself (GPLv3) is not bundled — following the license review, the lookup contract was re-implemented clean-room in TypeScript (no GPL code), and the corpus (CC BY-SA 3.0) is distributed separately; the MIT package contains no GPL files.
- **Validation scope**: structural validation only (dependency integrity, cycle detection) — mathematical proof correctness is out of scope, consistent with the upstream skill_base capability statement.

## Acceptance criteria and verification evidence

| Criterion | Evidence |
| --- | --- |
| Install/enable/remove via the official plugin mechanism | `dsh plugin add/remove` + `--dump-config` verified (npm tarball into a clean DSH_HOME) |
| "Task → Agent call → artifacts in workspace → continue processing" | 10+ headless scenarios pass with a real model: real paper structure extraction (arXiv 1311.4600), real QP solving (solution matches analytic KKT), real MATLAB computation, real OCR, and a Beamer template compiled to PDF during the run |
| Scripts/templates bundled with skills and actually callable | Upstream scripts included verbatim (diff-verified); the offline test suites of all nine upstream repositories pass (201 tests), with several suites bundled for regression gating; 100 synthetic vitest tests + a runtime probe (real DSH API, no remote model) green |
| Missing-dependency hints | Four environment probe tools (python/sage/beamer/osqp); the Lean forbidden-token scan needs no toolchain; structured install hints when missing |
| Upstream provenance | In-package `UPSTREAM.json` (commit-level records for 7 upstream repositories) + `NOTICE.md` + an integration-matrix document |

## Upstream adaptation and differences

Skill content and Python scripts are adapted from eight MIT repositories under the VeryMath org (commit-level provenance recorded). Main differences from upstream: several critical upstream steps rely on the model writing JSON by hand at run time (paper-graph merge/topology, glossary upsert invariants); the plugin fills these with deterministic TypeScript engines; glossary queries return examples and subfield disambiguation.

## Adoption path (maintainer's choice)

1. **Documentation listing**: add a community-plugin entry to README/docs linking npm and the repository (smallest change).
2. **Dependency recommendation**: recommend it as an optional plugin in the distribution config (installed via the DSH plugin mechanism from npm).
3. **Deeper integration**: vendor the source into the official repository or rename the npm scope — the author is willing to adjust if desired (full development history and attribution can be preserved in the migration).

## Maintenance

The plugin is maintained independently by the author (issues and PRs at https://github.com/LouisUltra/dsh-verymath); upstream VeryMath evolution is adapted against the versions recorded in `UPSTREAM.json`.
