---
name: invariant-computation
description: Use when a coding agent must compute, route, validate, or explain topological, geometric, or algebraic invariants such as homology, cohomology, Betti numbers, torsion, Euler characteristic, persistent homology, knot or manifold invariants, group homology, Hilbert series, Hilbert polynomials, Betti tables, dimensions, degrees, primary decompositions, or related invariants from mathematical objects, code, data, or papers.
---

# Invariant Computation Skill

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供。计算前端（GUDHI/SageMath/GAP/SnapPy 等）
  一律先探测再经用户批准安装——本技能的 `manifest.yaml` 审批策略在 DSH 会话中继续生效。
- 产出 `invariant_summary.json` 后，用 `verymath_paper_validate` 同族的校验纪律自查：
  `result_quality` 枚举（exact/certified_numerical/heuristic/partial/failed）必须如实，
  `remaining_uncertainty` 不可省略。
- 数学对象的 LaTeX 表示与结构 JSON（来自 math-paper-reading）可作为输入；产物写入当前会话工作区。


This Skill is an **Invariant Computation Routing & Verification** workflow for AI4Math tasks.

It helps a coding agent turn a mathematical object into a reviewed computational representation, choose an exact, symbolic, TDA, low-dimensional topology, group-homological, or certified numerical route, run only after approval, and report invariant evidence without overstating classification claims.

## Operating Principle

Keep six layers separate and reviewable:

1. **Source object:** what the user, paper, data file, code, or formula actually provides.
2. **Representation:** complex, chain complex, filtration, triangulation, knot diagram, group presentation, polynomial ideal, module, cone, or numerical system.
3. **Invariant target:** the exact invariant, coefficient ring or field, grading, orientation, filtration convention, and expected output form.
4. **Backend route:** tools and commands that can compute the invariant in the current environment.
5. **Validation checks:** structural checks, independent identities, small examples, or cross-tool comparisons.
6. **Evidence report:** logs, versions, artifacts, assumptions, failures, and limits.

Never let a backend's output outrun the reviewed representation and validation layer.

## Input Modes

Accept these inputs and route them through the same checkpoint:

- finite simplicial, cubical, Delta, CW, or chain complexes;
- point clouds, distance matrices, scalar fields, images, volumes, and explicit filtrations;
- manifold triangulations, ideal triangulations, census names, Dehn fillings, knots, links, braid words, PD codes, DT codes, or Gauss codes;
- finite groups, group presentations, permutation groups, polycyclic groups, and cellular group actions;
- polynomial rings, ideals, modules, quotient rings, schemes, varieties, sheaves, cones, monoids, and toric data;
- paper excerpts, LaTeX definitions, code, README instructions, or mixed mathematical bundles.

When the input is not already structured, write a `representation_checkpoint.md` before proposing executable commands.

## Reference Navigation

Start with `references/INDEX.md` for route selection.

Read only the references needed for the current task:

- `references/method_route_map.md`: read when classifying the mathematical object and invariant route.
- `references/tool_catalog.md`: read when choosing candidate tools and commands.
- `references/validation_checks.md`: read before accepting computed results.
- `references/failure_modes.md`: read when a computation fails, stalls, or returns suspicious evidence.
- `references/source_notes.md`: read when source attribution or official tool scope matters.

## Workflow

1. Identify the source object and requested invariant.
2. Ask for missing essentials only when they block representation: coefficient ring or field, dimension, orientation convention, grading, filtration direction, variable order, base field, or desired precision.
3. Build a representation checkpoint:

```text
source evidence:
object family:
representation:
target invariant:
coefficient ring or field:
conventions:
candidate exact routes:
candidate symbolic routes:
candidate certified numerical routes:
missing assumptions:
risks:
```

4. Choose a route using `references/method_route_map.md` and `references/tool_catalog.md`.
5. Write a bounded computation plan with exact commands, dependencies, expected outputs, timeout, and validation checks.
6. Ask before installing packages, changing environments, running long computations, editing source files, using remote APIs, or accepting final mathematical claims.
7. Run approved commands or draft backend-specific code only when appropriate.
8. Parse evidence into:

```text
outputs/<run_id>/
├── input_summary.md
├── representation_checkpoint.md
├── route_plan.md
├── commands/
├── logs/
├── results/invariant_summary.json
├── validation_report.md
└── RUN_SUMMARY.md
```

The JSON summary should validate against the
[versioned schema](schema/invariant_summary.schema.json). Use the
[known-answer example](examples/invariant_summary.example.json) as a shape
reference, not as evidence for a new computation.

9. Validate results using `references/validation_checks.md`.
10. Report the invariant, assumptions, checks passed, checks failed, software versions, and what the invariant does not prove.

## Route Families

- **Finite complexes:** use boundary matrices, Smith normal form, sparse field reductions, cochains, and Euler checks for homology, cohomology, Betti numbers, torsion, and cup products.
- **Persistent homology and TDA:** use filtered complexes, persistent cohomology, Rips/Cech/alpha/witness/cubical/lower-star routes, and diagram comparisons.
- **Low-dimensional topology and knot theory:** use triangulation, normal-surface, hyperbolic, and knot/link-diagram routes for homology, fundamental groups, knot groups, Alexander polynomials, Jones polynomials, HOMFLY-PT polynomials, determinants, signatures, linking numbers, volumes, and certified hyperbolic quantities.
- **Group and CW homological algebra:** use resolutions, chain complexes, group presentations, cellular actions, and abelianization checks for group homology and cohomology.
- **Algebraic geometry and commutative algebra:** use Groebner bases, syzygies, free resolutions, Hilbert series, primary decomposition, saturation, radicals, and sheaf or module methods.
- **Toric, polyhedral, and semigroup routes:** use cone, monoid, Hilbert basis, lattice-point, and toric ideal computations.
- **Numerical algebraic geometry:** use homotopy continuation, witness sets, monodromy, and interval or Krawczyk certification when exact symbolic routes are infeasible.

## Approval Rules

Ask before:

- installing GUDHI, SageMath, GAP/HAP, SnapPy, Regina, Macaulay2, Singular, OSCAR, polymake, Normaliz, or other mathematical systems;
- running expensive enumeration, Groebner basis, homotopy continuation, normal-surface, persistent-homology, or triangulation searches;
- changing source files, generated data, or computational environments;
- using remote services or API calls;
- stating final mathematical conclusions beyond the evidence.

Read-only inspection, local file parsing, and drafting route plans do not require approval unless the user has imposed stricter constraints.

## Validation

Use structural checks before trusting results:

- check simplicial closure, cubical dimensions, cell incidences, and `d_{n-1} d_n = 0`;
- verify filtration values are monotone on faces;
- record coefficient rings, fields, torsion visibility, and characteristic;
- compare Euler characteristic with alternating Betti sums;
- compare `H_1` with abelianization when a fundamental group or group presentation is available;
- use Poincare duality only when manifold hypotheses are verified;
- compare known examples such as spheres, tori, projective planes, lens spaces, the unknot, trefoil, figure-eight knot, Hopf link, cyclic groups, and standard ideals;
- cross-check with an independent backend for publication-grade claims when feasible;
- require certificates or interval-backed methods for floating hyperbolic or numerical algebraic geometry claims when available.

## Failure Modes

Call out these signals explicitly:

- representation is underspecified or not closed under faces;
- coefficient ring or characteristic changes the invariant;
- boundary maps do not compose to zero;
- filtrations have nonmonotone values or unstable tie-breaking;
- combinatorial explosion makes a naive route infeasible;
- Groebner, Smith normal form, or primary decomposition suffers coefficient swell;
- triangulation is nonmanifold, unsimplified, or convention-dependent;
- knot/link orientation, mirror, framing, normalization, reduced versus unreduced polynomial, or encoding conventions are unclear;
- numerical geometry is uncertified, ill-conditioned, or precision-sensitive;
- computed invariants are too weak to classify the object.

## Output Contract

Every final report should include:

- object representation and source evidence;
- invariant requested and invariant computed;
- coefficient ring or field and conventions;
- backend route and version evidence;
- exact command or code path used;
- a non-null invariant value unless the computation failed;
- validation checks and their results;
- unresolved ambiguity and next repair route;
- either a classification caveat or explicit theorem evidence supporting its omission.
