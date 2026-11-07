# OSQP Result Verification

Use these checks after reading the exact OSQP status. They are independent
recomputations, not substitutes for a derivation of the model.

## Feasible candidate

For the canonical QP and returned \(x,y\), recompute:

\[
r_{\mathrm{bound}}=
\max\{\|(l-Ax)_+\|_\infty,\|(Ax-u)_+\|_\infty\},
\]

\[
r_{\mathrm{stat}}=\|Px+q+A^\top y\|_\infty,
\qquad
f(x)=\tfrac12x^\top Px+q^\top x.
\]

Also check the normal-cone condition \(y\in N_{[l,u]}(Ax)\). With OSQP's dual
sign convention, use an activity tolerance and verify, row by row:

- \(y_i\approx0\) when no finite bound is active, including a free row;
- \(y_i\leq0\) at a lower bound that is not also an upper bound;
- \(y_i\geq0\) at an upper bound that is not also a lower bound;
- an equality row may have either sign.

Report the resulting normal-cone/complementarity residual separately. Primal
feasibility plus stationarity alone is not a complete optimality check.

Check \(P=P^\top\succeq0\) independently. Compare residuals against both the
requested tolerances and problem scale. OSQP's documented stopping tolerances
use absolute and relative terms; do not compare every scaled problem to one
unexplained hard-coded threshold.

If the application has stronger domain checks—dynamics defects in MPC, budget
balance in a portfolio, or physical units—run those as separate checks.

## Primal infeasibility

Reject a non-finite or numerically zero returned \(v\). Normalize a valid
direction as \(\hat v=v/\|v\|_\infty\), then check:

\[
\|A^\top \hat v\|_\infty\leq\epsilon_{\mathrm{prim\_inf}},
\qquad
u^\top \hat v_+ + l^\top \hat v_- < -\tau_{\mathrm{neg}}.
\]

Interpret the support expression with extended bounds. A positive component of
\(\hat v\) paired with \(u_i=+\infty\), or a negative component paired with
\(l_i=-\infty\), invalidates the direction beyond tolerance. Choose and record
the scale-aware strict-negative margin \(\tau_{\mathrm{neg}}>0\). Preserve the
raw certificate, normalized direction, norm, scale, and recomputed values.

## Dual infeasibility

Reject a non-finite or numerically zero returned \(s\). Normalize a valid
direction as \(\hat s=s/\|s\|_\infty\), then check:

\[
\|P\hat s\|_\infty\leq\epsilon_{\mathrm{dual\_inf}},
\qquad q^\top \hat s<-\tau_{\mathrm{neg}}.
\]

For each component of \(A\hat s\), also check:

- \( (As)_i\approx0 \) when both bounds are finite;
- \( (As)_i\geq0 \) when only the lower bound is finite;
- \( (As)_i\leq0 \) when only the upper bound is finite.

Rows open on both sides impose no direction restriction.

Choose and record a scale-aware \(\tau_{\mathrm{neg}}>0\). A tiny unnormalized
vector that only makes the expression negative by floating-point noise is not
an accepted infeasibility certificate.

## Status policy

The official status table states that inaccurate statuses satisfy conditions
with tolerances ten times larger than configured. Keep `solved inaccurate` and
inaccurate infeasibility classifications visibly tentative, even when a
downstream application elects to accept them.

Maximum-iteration, time-limit, interrupted, unsolved, and setup-error statuses
do not establish a solution or infeasibility conclusion. A `problem non convex`
status rejects the run, but the absence of that status does not prove that
\(P\succeq0\).

Official sources:

- <https://osqp.org/docs/solver/>
- <https://osqp.org/docs/interfaces/status_values.html>
