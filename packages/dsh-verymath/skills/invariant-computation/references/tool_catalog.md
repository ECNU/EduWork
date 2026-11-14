# Tool Catalog

This catalog lists candidate backends. Do not assume any tool is installed. Inspect the environment first and ask before installing or changing it.

## Finite Complexes And TDA

| Tool | Best fit | Inputs | Outputs |
| --- | --- | --- | --- |
| GUDHI | broad computational topology and persistent homology | simplex trees, cubical complexes, alpha/Cech/Rips/witness complexes | homology, persistence diagrams, filtrations, distances |
| Ripser.py | fast Vietoris-Rips persistence | point clouds, dense/sparse distance matrices | persistence diagrams, representative cocycles |
| Dionysus | custom filtrations and persistence variants | filtrations, Rips, lower-star data | persistence, cohomology, zigzag persistence |
| SageMath | exact simplicial and algebraic topology utilities | simplicial complexes and algebraic structures | homology, cohomology, algebraic calculations |
| polymake Topaz | simplicial and polyhedral computations | complexes, polytopes | homology, combinatorial and polyhedral invariants |

## Low-Dimensional Topology

| Tool | Best fit | Inputs | Outputs |
| --- | --- | --- | --- |
| Regina | 3- and 4-manifold triangulations, normal surfaces, knots and links | triangulations, normal surfaces, link diagrams | homology, normal surfaces, angle structures, knot/link invariants |
| SnapPy | topology and geometry of 3-manifolds | ideal triangulations, census names, Dehn fillings | homology, fundamental groups, hyperbolic volume, verified geometry routes |
| Spherogram | knots and links | PD, DT, braid, Gauss codes | link objects, Alexander and Jones style invariants, signatures, linking data |
| SageMath knot tools | exact knot computations in Sage workflows | knots and links | Alexander polynomials, Jones polynomials, HOMFLY-PT polynomials, signatures, determinants, related invariants |

## Group And Homological Algebra

| Tool | Best fit | Inputs | Outputs |
| --- | --- | --- | --- |
| GAP HAP | group homology, cohomology, CW complexes | groups, chain complexes, resolutions, CW data | homology, cohomology, rings, resolutions |
| Kenzo | effective homology and algebraic topology | spaces, chain complexes, simplicial sets | homology and effective reductions |
| GAP core packages | group representation and algebra | finite and finitely presented groups | abelianization, group data, support for HAP routes |

## Algebraic Geometry And Commutative Algebra

| Tool | Best fit | Inputs | Outputs |
| --- | --- | --- | --- |
| Macaulay2 | commutative algebra and algebraic geometry | polynomial rings, ideals, modules, sheaves | Groebner bases, Hilbert data, Betti tables, resolutions, primary decomposition |
| Singular | polynomial computations and singularity theory | ideals, modules, local/global rings | standard bases, Hilbert series, primary decomposition, singularity invariants |
| OSCAR | integrated computational algebra, geometry, and number theory | ideals, schemes, varieties, sheaves, toric data | commutative algebra, homological algebra, toric and tropical invariants |
| SageMath | integrated exact algebra and geometry workflows | rings, ideals, varieties, complexes | Groebner bases, dimensions, interfaces to specialized systems |

## Toric, Polyhedral, And Numerical Routes

| Tool | Best fit | Inputs | Outputs |
| --- | --- | --- | --- |
| Normaliz | cones, affine monoids, Hilbert bases | rational cones, monoids, lattice polytopes | Hilbert bases, Hilbert series, lattice points |
| 4ti2 | toric ideals and integer relations | matrices, toric data | Markov bases, Groebner bases, lattice basis data |
| HomotopyContinuation.jl | polynomial homotopy continuation | polynomial systems | roots, paths, witness data, certification support |
| Bertini or PHCpack | numerical algebraic geometry | polynomial systems | isolated roots, witness sets, numerical decompositions |

## Environment Inspection Patterns

Use read-only checks first:

```bash
python -c "import gudhi; print(gudhi.__version__)"
python -c "import ripser; print(ripser.__version__)"
sage --version
gap -q
M2 --version
Singular --version
python -c "import snappy; print(snappy.version())"
regina-python --version
```

Ask before installing any missing backend.
