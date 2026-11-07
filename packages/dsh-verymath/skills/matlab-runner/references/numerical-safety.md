# Numerical Safety Reference

> Path note: this file is addressed from `SKILL.md` as `./references/numerical-safety.md` and must be resolved relative to the directory containing that loaded `SKILL.md`.

Load this reference only for tasks involving numerical accuracy, ODEs, roots and residuals, statistics, complex output, conditioning, convergence, or reproducible randomness.

## General evidence rules

- Preserve complex values and display real and imaginary parts when interpretation depends on them.
- Equal real parts do not imply repeated roots.
- Use unrounded values for validation and round only for presentation.
- Do not infer multiplicity, conditioning, convergence, stability, or reliability without a calculation or a clearly stated theorem.
- Never invent a value that MATLAB did not return.

## Validate the reference before measuring error

An analytical solution, expected answer, reference vector, or benchmark is not automatically ground truth merely because it was supplied in the prompt or produced by the agent. Before using it to judge MATLAB output, apply the cheapest decisive checks.

For an ODE reference solution, check at least:

1. the initial or boundary condition at full precision;
2. the defining differential equation through an analytical residual or another justified check;
3. any domain, parameter, or branch condition that affects correspondence.

If a candidate reference fails one of these checks, do not use it to compute or interpret solver error. Either derive and validate a corrected reference, or report `VALIDATION_FAILURE` and stop the accuracy claim. A MATLAB call that runs successfully does not make an invalid reference valid.

For pointwise comparisons:

- use the same requested sample points for numerical and reference values;
- make orientation explicit, preferably with a column time vector such as `tq = (0:0.1:5).'`;
- verify equal element counts and matching dimensions before subtraction;
- use an assertion such as `assert(isequal(size(yNumerical),size(yReference)))` when shape mistakes would invalidate the result;
- do not rely on implicit expansion between a column and a row;
- using `(:)` is acceptable only after confirming that both vectors refer to the same ordered sample points.

A vector returned by `max` where a scalar was expected is evidence of a shape or dimension problem. Diagnose it; do not reinterpret the vector as a running maximum or another quantity without proof.

## Differential-equation residuals

For an equation such as `y' = f(t,y)`, the residual must contain the derivative of the proposed reference solution. Define or derive a separate derivative expression such as `yPrime(t)` and evaluate the residual in the equation's actual form.

For example, for `y' = -2y + sin(t)`, use:

```matlab
residual = yPrime(t) + 2*yExact(t) - sin(t);
```

Do not substitute `yExact(t)` where `yPrime(t)` is required. A residual formula that uses the wrong mathematical quantity invalidates the validation even when MATLAB executes it successfully.

When correcting a residual or reference formula:

- classify the earlier check as a recovered `VALIDATION_FAILURE`;
- recompute the residual from the corrected derivative or formula;
- recompute any reported quantities that depended on the invalid check;
- do not insert previously observed numerical outputs as constants in the corrective call.

## Residuals and backward error

An absolute residual alone may be misleading when the problem is scaled.

- Use a normalization appropriate to the equation or polynomial.
- Do not compare an unnormalized residual directly with machine epsilon and announce stability.
- State the quantity actually computed: absolute residual, relative residual, normalized backward error, or another measure.
- Do not use a small residual as proof of good conditioning.

## Statistics

State the convention when it matters.

- `std(A,0,'all')` uses `N-1` normalization when applicable.
- `std(A,1,'all')` uses `N` normalization.
- If NaN values are excluded by indexing, say that they were filtered before `mean` or `std`; do not say the functions ignored NaN automatically unless an omission option was actually used.

## Random experiments

For requested reproducibility:

1. set an explicit RNG seed;
2. report the seed and generator when relevant;
3. verify reproducibility when requested, for example by regenerating and comparing with `isequal`.

Do not change the shared session's RNG state unnecessarily. If preserving the prior RNG state matters, save and restore it explicitly.

## ODE solver tolerances

For `ode45` and other adaptive solvers:

- Treat `RelTol` and `AbsTol` as controls on estimated local error, not as guaranteed bounds on the global maximum error.
- Do not say an observed global error is “below the tolerance threshold” solely because it is numerically smaller than `RelTol`.
- If an exact solution exists, validate that solution against the initial or boundary data and the differential equation before computing the observed error.
- To assess improvement from tighter tolerances, rerun with explicit tighter values and compare measured errors.
- State whether values came from requested output points or interpolation.
- When the input time vector contains requested points, call them requested output points, not the solver's internal adaptive steps.
- Do not invent a rule such as “the global error is approximately a fixed multiple of `RelTol`” without a derivation or measurement supporting that specific claim.

## Default settings and optional diagnostics

When the user asks to compare a solver's default settings with explicit settings:

- use the solver without explicit option overrides for the default run;
- do not query or print exact default option values unless the user requested them or they are necessary to answer the task;
- keep optional option inspection out of the core computation call;
- if an optional diagnostic is attempted and fails, disclose it as a recovered `MATLAB_EXECUTION_ERROR` when a later call completes the task.

An empty field returned by `odeset()` means that the option was not explicitly set in that options structure. It is not evidence of a display problem. Do not infer or state a specific default value from an empty field. If the exact default is not required, say that the solver used its default settings and report the measured result.

## Complex eigenvalues and roots

- Print complex values with enough precision to preserve conjugate structure.
- Do not collapse a complex-conjugate pair into duplicate real numbers.
- Check algebraic multiplicity separately from numerical closeness.
- If the task concerns eigenvectors or conditioning, compute the relevant quantities rather than inferring them from eigenvalues alone.

## Numerical claims checklist

Before answering, verify:

- the formula matches the code and the validation reference itself has passed the required initial, boundary, equation, or invariant checks;
- the reported maximum is the maximum of the stated values;
- units and normalization are named;
- default and tightened settings are not mixed;
- sample points, element counts, orientation, and dimensions match, with no accidental implicit expansion;
- rounded display values are not reused for validation;
- every factual numerical conclusion is supported by actual output or a transparent calculation;
- every differential-equation residual uses the actual derivative term required by the equation;
- a corrective call recomputed affected quantities instead of hard-coding values from an earlier call.
