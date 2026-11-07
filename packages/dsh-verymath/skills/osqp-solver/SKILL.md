---
name: osqp-solver
description: "Model, solve, update, reproduce, and diagnose continuous convex quadratic programs with the OSQP Python interface, including canonical-form conversion, sparse CSC data, solver-status gates, residual checks, infeasibility certificates, warm starts, repeated parametric QPs, and academic citation. Use when a task names OSQP, osqp Python, operator-splitting QP, convex QP, model-predictive-control QP, portfolio QP, or asks to reproduce or debug OSQP results. Do not use for mixed-integer, nonconvex quadratic, nonlinear-constraint, or general conic/SOCP problems. In DSH use verymath_osqp_check for environment probing and verymath_osqp_solve for deterministic JSON-contract solving with independent verification."
---

# OSQP Solver

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供。工具优先：
  `verymath_osqp_check` 探测 osqp/numpy/scipy（含 osqp 主版本门 >=1,<2），
  `verymath_osqp_solve` 直接求解 JSON 契约的 QP（内置 11 态状态门与独立 KKT/证书验证，exit 0/2/3）。
- 工具不可用或问题超出工具护栏（稠密规模上限、n≤1000）时，回退到 `scripts/solve_qp.py` shell 执行。
- 数值证据（verification.json 等）写入 outputs/<run_id>/，可作为 paper-writing 技能 experiment 型断言的标准证据。
- 上游 status：VeryMath 仓内候选（未正式合并）；本插件钉住适配的 commit（见 UPSTREAM.json）。

## Scope

Work only with the continuous convex QP

\[
\begin{array}{ll}
\operatorname{minimize} & \frac12 x^\top P x + q^\top x \\
\operatorname{subject\ to} & l \leq A x \leq u,
\end{array}
\qquad P=P^\top\succeq 0.
\]

Treat OSQP as a numerical solver, not as a modeling oracle. Derive the model,
check dimensions and convexity, solve, and then independently verify what the
returned status means.

Route elsewhere when the task contains integer variables, a genuinely
indefinite \(P\), nonlinear constraints, or cones that cannot be represented by
linear bounds. Do not claim that failure to detect nonconvexity proves
convexity.

## Workflow

### 1. Freeze the interpreted model

Write a short modeling checkpoint before executable code:

```text
source:
variables and units:
objective before conversion:
constraints before conversion:
canonical P, q, A, l, u:
dimensions and expected sparsity:
why P is positive semidefinite:
requested accuracy and runtime budget:
ambiguities:
```

Confirm any interpretation that changes the mathematics. Keep the factor
\(\tfrac12\) visible: if the original quadratic is \(x^\top Qx\), then OSQP
usually needs \(P=2Q\).

### 2. Inspect the environment

Run the non-mutating probe:

```bash
python3 scripts/check_osqp_environment.py --json
```

Require `osqp`, `numpy`, and `scipy`. If they are missing, report:

```bash
python3 -m pip install 'osqp>=1,<2'
```

Obtain approval before changing an existing environment. Do not infer solver
availability from a package listing alone; import it with the probe. Require
`ready: true`: an importable but unsupported OSQP major version is not ready
for this runner.

### 3. Construct solver data deliberately

- Store `P` and `A` as `scipy.sparse.csc_matrix`.
- Reject materially asymmetric input. For differences within the declared
  symmetry tolerance, construct one canonical symmetric `P` and use that same
  matrix for the PSD, objective, stationarity, setup, and update checks. Pass
  its upper triangle to OSQP because the solver uses upper-triangular storage.
- Encode one row of \(l\leq Ax\leq u\) per equality, interval, lower bound, or
  upper bound. Use `numpy.inf` for open sides.
- Check `P.shape == (n, n)`, `q.shape == (n,)`, `A.shape == (m, n)`, and
  `l.shape == u.shape == (m,)`.
- Check `l <= u`, finite `P`, `q`, and `A`, and the scale of every row and
  column. Avoid accidental dense construction for large problems.

For small reviewable JSON problems, use
`scripts/solve_qp.py`. Read `references/python-api.md` before adapting the
runner to a production sparse model. The dense runner rejects inputs above
32 MiB, `n > 1000`, or more than `2,000,000` logical entries across `P` and
`A`.

### 4. Establish a baseline solve

Prefer the native Python interface for transparent solver data:

```python
import numpy as np
import osqp
from scipy import sparse

P = sparse.csc_matrix(...)
q = np.asarray(..., dtype=float)
A = sparse.csc_matrix(...)
l = np.asarray(..., dtype=float)
u = np.asarray(..., dtype=float)

model = osqp.OSQP()
model.setup(
    P=P,
    q=q,
    A=A,
    l=l,
    u=u,
    verbose=False,
)
result = model.solve()
```

Run defaults first unless the task already specifies settings. Record every
non-default setting. The bundled runner supports `osqp>=1,<2`. Use the OSQP v1
names `polishing` and `warm_starting`; consult `references/python-api.md` when
reproducing v0.6 code that used `polish` or `warm_start`, but preserve that
older reproduction in a separate pinned environment instead of passing it to
this runner.

Do not tune `rho`, `alpha`, scaling, or tolerances from folklore. First preserve
the baseline status, iteration count, residuals, and timing; then change one
justified setting at a time.

### 5. Apply the status gate

Interpret `result.info.status_val`, not a substring match on a log:

| Status class | Treatment |
| --- | --- |
| `solved` | Candidate solution; verify before accepting. |
| `solved inaccurate` | Tentative only; report the relaxed-status boundary and verify. |
| `primal infeasible` / `dual infeasible` | Candidate classification; verify the returned certificate. |
| inaccurate infeasibility | Tentative certificate only. |
| maximum iterations / time limit | No accepted solution; diagnose or revise the budget. |
| non convex | Reject the solve and revisit \(P\); detection is not exhaustive. |
| interrupted / unsolved / setup error | No mathematical conclusion. |

Never replace the status with a bare objective value or a visually plausible
vector.

### 6. Verify independently

For a feasible candidate \(x,y\), compute at minimum:

\[
\max\{\|(l-Ax)_+\|_\infty,\|(Ax-u)_+\|_\infty\},
\qquad
\|Px+q+A^\top y\|_\infty,
\]

also check the normal-cone/complementarity condition
\(y\in N_{[l,u]}(Ax)\), and recompute
\(\frac12x^\top Px+q^\top x\). Compare all residuals with the requested
absolute/relative tolerances and problem scaling.

Do not treat an objective below a known feasible optimum as an improvement
until feasibility has passed: a slightly infeasible numerical point can have a
spuriously lower objective.

For an infeasibility claim, verify the returned certificate using
`references/verification.md`. Reject zero or non-finite directions, normalize
the certificate by its infinity norm, and require a scale-aware strict negative
margin rather than accepting a value that is merely below zero. Distinguish:

- OSQP's reported residuals;
- an independent recomputation;
- the requested tolerances;
- any looser threshold used only for diagnosis.

### 7. Reuse setup for parametric QPs

For repeated problems with fixed dimensions and sparsity:

```python
model.update(q=q_new, l=l_new, u=u_new)
model.update(Px=Px_new, Ax=Ax_new)
result = model.solve()
```

OSQP automatically warm starts from the previous solution. Use
`model.warm_start(x=x0, y=y0)` only when supplying an intentional external
initial point.

Matrix updates may change numerical values but not the sparsity pattern. Re-run
`setup` when a pattern or dimension changes. Benchmark setup time separately
from update and solve time. Do not infer a speedup from one tiny, warm-started,
microsecond-scale observation.

### 8. Preserve evidence

Save durable artifacts under `outputs/<run_id>/`:

```text
model.md                 interpreted mathematics and assumptions
problem.json             exact small runner input, when used
settings.json            OSQP version and non-default settings
result.json              status, solution or certificate, and timings
verification.json        independently recomputed checks
run.log                  command and diagnostics
```

Report:

1. the exact QP and interface version;
2. status and whether it passed the gate;
3. objective, residuals, and certificate checks;
4. settings and warm-start/update behavior;
5. limitations and unresolved numerical concerns.

For published work, read `references/citation.md` and include the relevant
official OSQP citation.

When using the bundled CLI, preserve its machine-readable stream contract:
success writes exactly one JSON document to standard output, and errors write
exactly one JSON document to standard error. Reject `settings.verbose: true`.
Never use the input path as `--output`; use a run-specific destination because
a distinct existing output may be atomically replaced.

## Bundled Resources

- `scripts/check_osqp_environment.py`: inspect Python and OSQP dependencies
  without installing anything.
- `scripts/solve_qp.py`: solve and independently check a small dense JSON QP;
  use it as an auditable runner, not a large sparse-data format.
- `references/python-api.md`: source-backed Python setup, update, warm-start,
  settings, and version notes.
- `references/verification.md`: residual and infeasibility-certificate checks.
- `references/citation.md`: official publication citations.
- `references/*-example.json`: feasible, primal-infeasible, and
  dual-infeasible smoke problems.
- `requirements-test.txt`: minimal OSQP 1.x dependency for isolated numerical
  tests.
