# dsh-verymath

**English** | [简体中文](README.md)

<p align="center"><strong>Community plugin bringing VeryMath math-research capabilities to DSH / EduWork.</strong><br><sub>Bilingual math glossary · structured paper reading · skills + tools in one package</sub></p>

`@eduwork/dsh-verymath` packages the VeryMath AI4Math skills and tools as a [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin for [EduWork](https://github.com/ECNU/EduWork) and other DSH 0.2.x hosts. It addresses the first-phase scenarios of [ECNU/EduWork#152](https://github.com/ECNU/EduWork/issues/152).

## What it provides

**Model-facing tools** (available right after install; the Agent calls them automatically):

| Tool | Purpose |
| --- | --- |
| `verymath_glossary_query` | Query a bilingual (English-Chinese) math glossary JSON: exact, prefix, substring, term_id, and subfield matching; returns examples and supports subfield disambiguation. |
| `verymath_glossary_build` | Run the upstream `math-glossary` Python scripts to build or extend a glossary from CSV/TSV/JSON/YAML. |
| `verymath_glossary_upsert` | Save terms while reading/translating: maintains contract invariants (term_id, ordering, contiguous idx) automatically — no hand-editing of glossary.json. |
| `verymath_python_check` | Check local Python 3 availability and surface installation hints. |
| `verymath_paper_validate` | Validate `math-paper-reading` `<slug>_structure.json` artifacts (entity kinds, dependency integrity). |
| `verymath_paper_graph` | Paper dependency-graph engine: batch merging, `cited_by` reconstruction, `shared_node` hubs, cycle detection, both reading directions, `focus` transitive closure, Mermaid rendering (auto-degrades above 40 entities). |
| `verymath_ocr_scan` | OCR Markdown error-candidate locator (22 rule categories: glued operators, font misreads, dollar imbalance, environment mismatches; candidates only, for the after-ocr review protocol; needs Python). |
| `verymath_osqp_check` / `verymath_osqp_solve` | OSQP stack probe (major-version gate >=1,<2) / JSON-contract QP solving with 11-state status gates and independent KKT/certificate verification (needs the osqp Python stack). |
| `verymath_lean_detect_sorry` | Scans Lean files for sorry/admit/axiom — **no Lean toolchain needed** (requires local Python 3; the script ships with the package), a patch acceptance gate. |
| `verymath_research_gate` | Three-gate validation for research workspaces (goal approval / workstream completion / final render): mandatory report.md sections, independent-reviewer rule, blocking-review resolution — pure file-contract validation. |
| `verymath_sage_check` / `verymath_sage_search` | SageMath docs-corpus + binary probe / anti-hallucination API lookup across 3196 official docs. The corpus comes from the official SageMath Sphinx reference manual (10.9.beta9, CC BY-SA 3.0), defaults to `~/.verymath/sagemath-corpus` (override with `VERYMATH_SAGE_CORPUS`); documentation lookup only — **no Sage code execution**. The GPLv3 Sagemath-skill body is not bundled; lookup and scoring are a clean-room TypeScript re-implementation. |
| `verymath_beamer_check` | TeX toolchain probe for math-beamer compiles: latexmk, xelatex (needed by Chinese/bilingual templates), forest/ctex packages (located via kpsewhich); installs nothing, surfaces an install hint and deliver-.tex-only guidance when pieces are missing. |

**Bundled skills** (registered in the DSH skill catalog; model- and user-invocable):

| Skill | Purpose | Upstream |
| --- | --- | --- |
| `math-glossary` | Full workflow to build, maintain, and query bilingual glossaries from PDFs, dictionaries, and tables. | [AI4Math-MathTool](https://github.com/VeryMath/AI4Math-MathTool) `math-glossary` v0.1.0 |
| `math-paper-reading` | Structured extraction, theorem-dependency analysis, deep reading, literature search, reference management. | [AI4Math-Paper-Reading](https://github.com/VeryMath/AI4Math-Paper-Reading) v4.2 |
| `graph-theory-paper-reading` | Six-dimension deep reading of graph-theory papers with proof-tree LaTeX reports. | [AI4Math-Paper-Reading](https://github.com/VeryMath/AI4Math-Paper-Reading) |
| `after-ocr` | Whole-document review and repair discipline for formula-dense OCR Markdown. | [AI4Math-Paper-Reading](https://github.com/VeryMath/AI4Math-Paper-Reading) |
| `paper-writing` | Source-grounded mathematical paper writing: skeletons, claim-evidence ledgers, obligation audits, notation consistency. | [AI4Math-Writing](https://github.com/VeryMath/AI4Math-Writing) |
| `discover-math-problems` | Math-problem discovery: from vague background to problem menus, conjecture lattices, and work orders. | [AI4Math-Auto-Research](https://github.com/VeryMath/AI4Math-Auto-Research) |
| `proof-blueprint-review` | Proof blueprint generation with verifier-style review (generator/verifier role separation). | [AI4Math-Auto-Research](https://github.com/VeryMath/AI4Math-Auto-Research) |
| `open-problem-research-pipeline` | Open-problem workflow: literature search → method analysis → proof framework → report. | [AI4Math-Auto-Research](https://github.com/VeryMath/AI4Math-Auto-Research) |
| `least-squares` | Least-squares fitting and parameter estimation (OLS/WLS/regularized/nonlinear/Bayesian, 12-tier degradation). | [AI4Math-Computational-Mathematics](https://github.com/VeryMath/AI4Math-Computational-Mathematics) |
| `invariant-computation` | Routing and evidence reporting for algebraic/topological/geometric invariant computation (approval-gated installs). | [AI4Math-Computational-Mathematics](https://github.com/VeryMath/AI4Math-Computational-Mathematics) |
| `mixed-integer-programming` | MILP modeling and solving: tested knapsack/assignment examples (PuLP+CBC) + restored upstream LP examples. | [AI4Math-Optimization](https://github.com/VeryMath/AI4Math-Optimization) (broken examples repaired) |
| `matlab-runner` | MATLAB execution routing/safety/reporting layer — drives local MATLAB via the official MathWorks MCP server (requires user-installed MATLAB + license). | [AI4Math-MathTool](https://github.com/VeryMath/AI4Math-MathTool) |
| `math-beamer` | Mathematical Beamer slide decks: 23 template packs (bilingual, per-field), 4-gate guided workflow, slide-source-ledger provenance. | [AI4Math-Writing](https://github.com/VeryMath/AI4Math-Writing) |
| `lean-formalization` | Lean 4 formalization, proof repair, sorry completion, and patch review (coding-agent-first; the GB-scale toolchain stays on the user machine). | [AI4Math-Lean-Agents](https://github.com/VeryMath/AI4Math-Lean-Agents) |
| `lean-setup` | Lean/elan/lake/mathlib workspace detection, install guidance, and two-level readiness reporting. | [AI4Math-Lean-Agents](https://github.com/VeryMath/AI4Math-Lean-Agents) |

> Deferred (rationale and upgrade paths in `docs/integration-matrix.md`): Sagemath-skill skill body (GPLv3; route-a
> clean-room TS lookup shipped, corpus distributed separately), paper-to-skill chain (MinerU cloud-API privacy; local mineru optional), agent-laboratory-workflow (external LLM API + heavy deploy),
> scientific-computing-reproduction (Codex ecosystem coupling; zero-dep scripts extractable on demand),
> co-mathematician (standalone app; concepts only), textbook-copilot (Apache-2.0 standalone app).

Skills carry the methodology; tools carry deterministic execution. The plugin cooperates naturally with DSH sessions, workspaces, sandboxing, and other plugins such as `literature` (e.g. fetch full text with `literature_fulltext`, then analyze it with `math-paper-reading`).

## Installation and usage

Requires Node.js `24.18.0+` and DSH `0.2.x (since 0.2.0-rc.1)`.

```sh
dsh plugin --profile <your-profile> add @eduwork/dsh-verymath
```

Or build from source:

The package source lives in this repository at `packages/dsh-verymath/`:

```sh
cd packages/dsh-verymath
npm install && npm run check
```

Then just ask in a session, e.g. "look up the Chinese term for manifold" or "read the structure of this paper". Artifacts (`glossary.json`, `<slug>_structure.json`, structure reports) are written into the current session workspace.

### Dependencies

- **Query and paper validation**: no external dependencies.
- **Glossary build/export** (`verymath_glossary_build`): requires a local Python 3 plus the upstream script dependencies (`PyYAML`; Excel export additionally needs `openpyxl`, the web UI needs `Flask`). Check availability with `verymath_python_check` first and install per its hints; the plugin does not bundle Python.
- **Platforms**: verified on macOS (Apple Silicon) (DSH CLI sandbox + the EduWork 0.4.3 desktop app itself); Windows should work (Node and Python on PATH) but is not yet tested — feedback welcome.

## Continuous integration

`.github/workflows/check.yml` runs `typecheck → build → test → runtime probe` on every push and pull request (GitHub Actions, Node 24).

## Developing from source

```sh
npm run typecheck     # tsc --noEmit
npm run build         # tsc → lib/
npm test              # vitest synthetic tests (no network)
npm run test:runtime  # real DSH API probe (synthetic data, no model calls)
npm run check         # all of the above
```

## License and provenance

This package is MIT licensed (`LICENSE`). Skill content and Python scripts are adapted from VeryMath's MIT projects; the adapted commits and paths are recorded in `UPSTREAM.json`, with attribution details in `NOTICE.md`. Thanks to the VeryMath team and upstream contributors.

## Differences from upstream VeryMath

- **Paper dependency graph as a tool**: upstream `skill_base`/`skill_pathway_proof` explicitly forbid model-side manual graph traversal but ship no merge/topology scripts (the model regenerates one each time). This plugin implements a deterministic TypeScript engine (`verymath_paper_graph`); the paper-reading critical path no longer requires Python.
- **Glossary read/write loop**: `verymath_glossary_upsert` maintains the upstream contract invariants (term_id derivation, ordering, contiguous idx) that upstream leaves to hand-edits.
- **Disambiguation**: queries return examples and support subfield filtering, implementing the upstream usage-guide strategies that could not execute in DSH before.
- **Validation scope**: this plugin performs structural validation (dependency integrity, cycles, dangling/isolated nodes) and does not verify mathematical proof correctness — consistent with the upstream `skill_base` capability boundary.

## Known limitations

- MDX dictionaries, OCR scans, and the web management UI follow the skill workflow (shell) and are not exposed as plugin tools.
- Glossary build/export still requires Python (query, upsert, and the paper-graph engine do not).
- Upstream remains under active development; the adapted upstream versions are recorded in `UPSTREAM.json`.
