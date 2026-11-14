# OSQP Python API Notes

Use this reference after the mathematical model has been converted to OSQP's
canonical QP form.

The bundled environment probe and JSON runner support `osqp>=1,<2`. Keep an
older OSQP reproduction in a separately pinned environment; do not interpret
successful imports from OSQP v0.6 as runner readiness.

## Source ledger

- Problem form and algorithm: <https://osqp.org/docs/solver/>
- Python interface: <https://osqp.org/docs/interfaces/python.html>
- Solver settings: <https://osqp.org/docs/interfaces/solver_settings.html>
- Status values and errors:
  <https://osqp.org/docs/interfaces/status_values.html>
- Python installation: <https://osqp.org/docs/get_started/python.html>
- Migration from v0.6 to v1:
  <https://osqp.org/docs/get_started/migration_guide.html>
- Code generation: <https://osqp.org/docs/codegen/index.html>

The URLs above are the official OSQP documentation and should be rechecked when
version-specific behavior matters.

## Setup and result

Use `P` and `A` as SciPy CSC sparse matrices, and `q`, `l`, and `u` as NumPy
vectors:

```python
model = osqp.OSQP()
model.setup(P=P, q=q, A=A, l=l, u=u, verbose=False)
result = model.solve()
```

OSQP uses only the upper-triangular part of `P`. Reject materially asymmetric
input, explicitly canonicalize within-tolerance asymmetry, and use the same
symmetric matrix for setup and every independent check. The result exposes
`x`, `y`, `prim_inf_cert`, `dual_inf_cert`, and an `info` record containing the
status, objective, residuals, iterations, and timing.

## Repeated solves

Update vectors without a new setup:

```python
model.update(q=q_new, l=l_new, u=u_new)
```

Update matrix values while preserving the original sparsity pattern:

```python
model.update(Px=Px_new, Ax=Ax_new)
```

OSQP automatically warm starts from its previous solution. Supply an external
initial point only when it is intentional:

```python
model.warm_start(x=x0, y=y0)
```

Re-run `setup` if dimensions or sparsity patterns change.

## Settings discipline

Start from defaults and record non-default values. Common v1 settings include
`eps_abs`, `eps_rel`, `eps_prim_inf`, `eps_dual_inf`, `max_iter`,
`time_limit`, `polishing`, `warm_starting`, `adaptive_rho`, `rho`, and
`alpha`.

OSQP v1 renamed the v0.6 setting `polish` to `polishing` and `warm_start` to
`warm_starting`. Preserve the original OSQP version when reproducing old code;
do not silently mix names or compare timings across changed backends.

The small JSON runner rejects `verbose: true` to keep standard output as one
machine-readable JSON document. Treat its settings object as a controlled
runner interface, not as an unrestricted pass-through to OSQP.

## Interface choice

Use the native Python interface when exact `P`, `q`, `A`, `l`, `u`, update
behavior, or OSQP diagnostics matter. A modeling layer such as CVXPY can be
useful for expression conversion, but record the modeling-layer version, the
selected `OSQP` backend, solver options, and the final status. Do not assume a
modeling-layer status exposes every native OSQP diagnostic.

Use code generation only for a fixed family of QPs after the native model and
update contract have been validated. The official generator fixes dimensions;
matrix-parameter mode also assumes fixed sparsity patterns.

The bundled dense JSON runner accepts at most a 32 MiB input, `n <= 1000`, and
`2,000,000` logical entries across `P` and `A`. Larger models should use the
native sparse interface and application-specific storage rather than weakening
this review guard.
