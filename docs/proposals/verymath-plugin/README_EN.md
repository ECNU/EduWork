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
| Version | 0.3.2 |
| License | MIT (package). `UPSTREAM.json` records 8 VeryMath upstream repositories: content from 7 MIT repositories is adapted/bundled, and 1 GPLv3 repository (Sagemath-skill) contributes **no code** — only an interface contract, re-implemented clean-room; the SageMath documentation corpus (CC BY-SA 3.0) is distributed separately |
| DSH compat | peer range `>=0.2.0-rc.1 <0.3.0-0`; **verified only on DSH 0.2.0-rc.2 + EduWork 0.4.3** — rc.1 and later 0.2.x releases are not individually tested |
| Node | `>=24.18.0` (`engines` in `package.json`) |
| Platform | macOS (Apple Silicon) verified only; **Windows is untested** — path and binary-discovery behaviour is unverified, especially for scenarios needing TeX, MATLAB, osqp or similar external environments |

## Capability list

**14 model tools**: glossary query/upsert/build (`verymath_glossary_query/upsert/build`), environment probes for Python/Sage/Beamer/OSQP (`verymath_python_check`, `verymath_sage_check`, `verymath_beamer_check`, `verymath_osqp_check`), QP solving with independent KKT verification (`verymath_osqp_solve`), paper structure validation (`verymath_paper_validate`), paper dependency-graph engine (`verymath_paper_graph`), OCR error-candidate locator (`verymath_ocr_scan`), Lean forbidden-token scan (`verymath_lean_detect_sorry`, no Lean toolchain required but needs Python 3), anti-hallucination Sage corpus search (`verymath_sage_search`), research workspace gate validation (`verymath_research_gate`).

**16 bundled skills** (registered into the DSH skill catalog through the plugin's skill provider): `math-glossary`, `math-paper-reading`, `graph-theory-paper-reading`, `after-ocr`, `paper-writing`, `math-beamer`, `discover-math-problems`, `proof-blueprint-review`, `open-problem-research-pipeline`, `least-squares`, `invariant-computation`, `mixed-integer-programming`, `osqp-solver`, `lean-formalization`, `lean-setup`, `matlab-runner`.

Every capability's scenario example (who/when, copy-paste prompt, sample input, expected output, run conditions and verification) is in [`capability-examples.md`](capability-examples.md). The examples are currently written in Chinese (the target students' language); an English translation can be added if maintainers want one.

## Compatibility boundaries

- **No EduWork public-interface changes**: the plugin integrates only through the DSH plugin API (tool registration, skill registration, fs service); workspace writes go through the existing sandbox authorization — no new permission surface.
- **External environments checked on demand**: Python/Sage/TeX/Lean/MATLAB are user-installed; the plugin probes and surfaces missing-dependency hints, never auto-installs and never bundles heavy dependencies. Sage support is **documentation lookup only** (no Sage code execution); the corpus comes from the official SageMath Sphinx reference manual (10.9.beta9, CC BY-SA 3.0, 3196 docs) and defaults to `~/.verymath/sagemath-corpus`. MATLAB needs a user-installed MATLAB + licence plus the official MathWorks MCP server, which sits outside the plugin API.
- **License isolation**: the Sagemath-skill package (GPLv3) is not bundled; the lookup/scoring contract was re-implemented clean-room in TypeScript from its public documentation (no GPL code in the MIT package). This boundary is currently self-attested: the implementation follows the documented lookup/scoring behaviour and copies no source. If maintainers want a stricter process description, the author can provide one.
- **Validation scope**: structural validation only (dependency integrity, cycle detection) — mathematical proof correctness is out of scope, consistent with the upstream skill_base capability statement.

## Acceptance criteria and verification evidence

| Criterion | Evidence |
| --- | --- |
| Install/enable/remove via the official plugin mechanism | `dsh plugin add/remove` + `--dump-config` verified (npm tarball into a clean DSH_HOME) |
| "Task → Agent call → artifacts in workspace → continue processing" | All 14 capabilities have real run records (real model, macOS): paper structure extraction (arXiv 1311.4600), QP solving (solution matches analytic KKT), MATLAB computation, OCR proofreading, Beamer compiled to PDF, and more. The runs surfaced one tool defect, fixed in 0.3.2 |
| Scripts/templates bundled with skills and actually callable | Upstream **Python scripts** included verbatim (diff-verified; SKILL.md, frontmatter and some tests are adapted for DSH — see `UPSTREAM.json` per entry); the **9 offline test suites across 8 upstream repositories** (201 tests) all pass, with several suites bundled for regression gating; **102** synthetic vitest tests + a runtime probe (real DSH API, no remote model) green |
| Missing-dependency hints | Four environment probe tools (python/sage/beamer/osqp) plus a Lean forbidden-token scan that needs no Lean toolchain (but does need Python 3); structured install hints when something is missing |
| Upstream provenance | In-package `UPSTREAM.json` (8 upstream repositories, all with full 40-character commit hashes) + `NOTICE.md` + an integration-matrix document |

## Upstream adaptation and differences

Skill content and Python scripts are adapted from 7 MIT repositories under the VeryMath org (commit-level provenance recorded); a further GPLv3 repository is used only as an interface reference and contributes no code. Main differences from upstream: several critical upstream steps rely on the model writing JSON by hand at run time (paper-graph merge/topology, glossary upsert invariants); the plugin fills these with deterministic TypeScript engines; glossary queries return examples and subfield disambiguation.

## Adoption path (maintainer's choice)

1. **Documentation listing**: add a community-plugin entry to README/docs linking npm and the repository (smallest change).
2. **Dependency recommendation**: recommend it as an optional plugin in the distribution config (installed via the DSH plugin mechanism from npm).
3. **Deeper integration**: vendor the source into the official repository or rename the npm scope — the author is willing to adjust if desired (full development history and attribution can be preserved in the migration).

## Maintenance

## Open migration questions

If the maintainers choose adoption (path 1), the following need to be settled first:

1. Where the plugin lives in the EduWork repository (`dsh-plugins/` or another convention)
2. Who runs the `@eduwork` npm publish and what access the author needs
3. Whether examples live in the plugin's `docs/` or in EduWork's documentation tree
4. What happens to the existing `LouisUltra/dsh-verymath` repository and `@louisultra/dsh-verymath` package (archiving + npm deprecate is one option)
5. How the commit history is merged (`git subtree` or the maintainers' preferred method) so authorship is preserved
6. Which copy of the docs becomes authoritative after migration, to avoid drift

## Maintenance

The author is willing to become the primary maintainer of the plugin inside the EduWork repository (see the PR discussion). Until the migration is settled, issues and PRs stay at https://github.com/LouisUltra/dsh-verymath; upstream VeryMath evolution is adapted against the versions recorded in `UPSTREAM.json`.
