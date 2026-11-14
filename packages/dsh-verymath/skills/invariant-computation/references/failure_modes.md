# Failure Modes And Repair Routes

## Representation Failures

| Signal | Likely cause | Repair |
| --- | --- | --- |
| missing faces or incidence errors | invalid complex input | close under faces or rebuild from facets |
| `d d != 0` | orientation, indexing, or boundary error | inspect boundary convention and run a tiny example |
| filtration value decreases on a face | invalid filtration | recompute lower-star or enforce monotonicity |
| nonmanifold warning | triangulation does not satisfy manifold hypotheses | switch to complex route or repair triangulation |
| knot invariant mismatch | mirror, orientation, framing, polynomial normalization, or encoding convention issue | compute unknot, trefoil, figure-eight, or Hopf-link sanity examples under the same convention |

## Algorithmic Failures

| Signal | Likely cause | Repair |
| --- | --- | --- |
| memory blow-up in Rips complex | combinatorial explosion | lower max dimension, use sparse distances, use Ripser, or sample |
| Smith normal form stalls | coefficient swell | compute over fields first, simplify complex, use sparse or modular routes |
| Groebner basis stalls | term-order or coefficient swell | change term order, use elimination only when needed, try Singular/Macaulay2 |
| primary decomposition differs by backend | field, saturation, or embedded component convention | record assumptions and compare radicals |
| normal-surface enumeration explodes | triangulation too large | simplify triangulation or compute weaker invariants first |
| group homology incomplete | resolution length or group class limits | report partial degree range and seek a better resolution route |

## Numerical And Certification Failures

| Signal | Likely cause | Repair |
| --- | --- | --- |
| hyperbolic invariant is floating only | precision-sensitive computation | use verified/interval route when available |
| path tracking loses roots | ill-conditioned homotopy | increase precision, change homotopy, or certify only stable roots |
| residuals are large | wrong system or numerical instability | rescale, inspect equations, rerun with higher precision |
| certificate fails | singular or near-singular solution | report failure and avoid final exact claims |

Treat missing certification as a result-quality warning whenever a numerical route is used for a theorem-level claim.

## Interpretation Failures

- Do not infer homeomorphism, isomorphism, isotopy, or variety equality from matching weak invariants alone.
- Do not compare invariants computed over different coefficient rings without saying so.
- Do not hide missing hypotheses such as compactness, orientability, grading, reduced versus unreduced convention, or base-field characteristic.
- Do not treat an installed backend's default convention as universal mathematical notation.
