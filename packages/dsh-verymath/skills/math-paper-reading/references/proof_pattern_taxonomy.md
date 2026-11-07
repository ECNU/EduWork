# Proof Pattern Taxonomy

First-pass `proof_pattern` types for paper-to-skill extraction.

## descent_lemma_auto_derivation

Trigger cues: L-smoothness, smoothness upper bound, gradient descent, one-step descent, step size condition.

Inputs: objective, iteration rule, smoothness assumption, step size.

Outputs: one-step descent inequality, descent condition, proof skeleton.

Core steps: apply smoothness inequality; substitute update rule; simplify inner products; collect norm terms; derive step-size restriction.

Risks: nonsmooth terms, stochastic gradients, missing bounded-below condition, invalid step-size range.

## inequality_relaxation

Trigger cues: Young's inequality, Cauchy-Schwarz, Holder, AM-GM, Jensen, triangle inequality, epsilon split.

Inputs: cross term or hard-to-bound expression, target norm structure, tunable constants.

Outputs: relaxed upper bound, separated terms, parameter constraints.

Core steps: identify troublesome product; choose inequality; introduce balancing parameter; align terms with Lyapunov or descent expression.

Risks: constants may be too loose; missing integrability or norm assumptions.

## telescoping_convergence_bound

Trigger cues: summing over k, telescoping, global convergence, O(1/T), cumulative decrease, bounded below.

Inputs: one-step inequality, lower bound, iteration horizon.

Outputs: averaged bound, convergence rate, residual estimate.

Core steps: sum the one-step inequality; cancel adjacent terms; use boundedness; divide by horizon; extract minimum or average residual.

Risks: nonmonotone potentials, missing lower bound, incorrect residual averaging.

## error_decomposition_skeleton

Trigger cues: decompose the error, approximation error, estimation error, discretization error, consistency plus stability.

Inputs: total error target, intermediate reference object, norms.

Outputs: decomposed error terms and proof obligations.

Core steps: add and subtract reference quantities; apply triangle inequality; bound each component by a specialized argument.

Risks: wrong norm compatibility; hidden regularity assumptions.

## lyapunov_potential_construction

Trigger cues: Lyapunov function, potential, energy estimate, supermartingale, decrease condition.

Inputs: state variables, residuals, candidate weights, update relation.

Outputs: potential function, one-step decrease inequality, stability or convergence proof skeleton.

Core steps: choose terms to track; weight them to cancel cross terms; prove descent; sum over iterations.

Risks: weights may require unknown constants; potential may not be nonnegative.

## concentration_bound_selection

Trigger cues: Hoeffding, Bernstein, sub-Gaussian, sub-exponential, martingale, union bound, high probability.

Inputs: random variables, dependence structure, tail assumptions, index class size.

Outputs: high-probability deviation bound and parameter choice.

Core steps: identify tail regime; choose inequality; set confidence parameter; union bound if needed.

Risks: dependence assumptions, variance proxy mismatch, infinite classes.

## uniform_convergence_bound

Trigger cues: covering number, Rademacher complexity, VC dimension, uniform law, generalization bound.

Inputs: function class, sample size, loss bound, complexity measure.

Outputs: uniform deviation or generalization bound.

Core steps: symmetrize; bound complexity; apply concentration; solve for sample rate.

Risks: measurability, unbounded losses, invalid complexity bound.

## cea_galerkin_orthogonality

Trigger cues: Cea lemma, Galerkin orthogonality, coercivity, continuity, finite element error.

Inputs: variational problem, discrete space, bilinear form, exact and discrete solutions.

Outputs: quasi-best approximation error bound.

Core steps: prove Galerkin orthogonality; use coercivity; apply continuity; minimize over discrete space.

Risks: noncoercive forms, inconsistent discretization, wrong norm.

## aubin_nitsche_duality

Trigger cues: Aubin-Nitsche, dual problem, L2 error, elliptic regularity.

Inputs: energy norm estimate, dual problem, regularity estimate.

Outputs: improved lower-norm error bound.

Core steps: define dual solution for error; use Galerkin orthogonality; apply approximation estimate; combine with energy bound.

Risks: missing dual regularity, nonsymmetric operators, boundary regularity.

## lax_milgram_wellposedness

Trigger cues: Lax-Milgram, coercive bilinear form, bounded linear functional, weak solution.

Inputs: Hilbert space, bilinear form, linear functional.

Outputs: existence, uniqueness, stability estimate.

Core steps: verify boundedness; verify coercivity; verify linear functional continuity; invoke Lax-Milgram.

Risks: wrong function space, coercivity only on a subspace, missing boundary conditions.
