# Method Route Map

## Finite Complexes

Use for simplicial, cubical, Delta, CW, or explicit chain complexes.

Representations:

- facets or maximal simplices;
- cubical grids, images, or voxel volumes;
- cell boundary maps;
- sparse matrices over `Z`, `Q`, or finite fields.

Invariants:

- homology and cohomology groups;
- Betti numbers and torsion;
- Euler characteristic;
- cup products and cohomology ring data when supported;
- fundamental group only when the chosen backend supports it and the representation is valid.

Default route:

1. Verify closure and incidence consistency.
2. Build boundary maps and check `d_{n-1} d_n = 0`.
3. Use exact integer or field reductions for small and medium cases.
4. Use sparse field reductions, discrete Morse reductions, or backend-native simplification for large cases.

## Persistent Homology And TDA

Use for point clouds, distance matrices, scalar fields, images, volumes, explicit filtered complexes, and time-indexed data.

Representations:

- Vietoris-Rips, Cech, alpha, witness, cubical, lower-star, or explicit filtration;
- distance matrix or sparse graph;
- coefficient field and maximum dimension.

Invariants:

- barcodes;
- persistence diagrams;
- persistent Betti numbers;
- representative cycles or cochains when available;
- bottleneck or Wasserstein distances for comparisons.

Default route:

1. Verify filtration monotonicity and coefficient field.
2. Estimate size growth before building high-dimensional Rips complexes.
3. Prefer Ripser.py for fast Rips persistence and GUDHI for broader filtrations.
4. Cross-check tiny examples across two backends when results matter.

## Low-Dimensional Topology And Knot Theory

Use for 2-, 3-, and 4-manifold triangulations, ideal triangulations, knots, links, braids, and census objects.

Representations:

- triangulation files or census names;
- Dehn fillings;
- PD, DT, Gauss, braid, or planar link diagrams;
- normal-surface or angle-structure data.

Invariants:

- homology;
- fundamental group presentations;
- normal surfaces and decomposition signals;
- knot groups and Wirtinger presentations;
- Alexander, Jones, HOMFLY-PT, Kauffman bracket, and other knot or link polynomials when supported;
- determinants, signatures, Arf invariant, linking numbers, component data, and crossing or diagram statistics when supported;
- hyperbolic volume, canonical retriangulation, and isometry signatures when supported.

Default route:

1. Verify encoding conventions and manifold hypotheses.
2. For knots and links, record orientation, mirror convention, component ordering, framing if present, and polynomial normalization.
3. Simplify triangulations or diagrams when backend-safe.
4. Use exact combinatorial invariants before floating geometric invariants.
5. Prefer interval or verified routes for hyperbolic claims when available.

## Group And CW Homological Algebra

Use for finite groups, permutation groups, fp groups, polycyclic groups, cellular actions, and CW-complex chain data.

Representations:

- group presentations or machine-native group objects;
- free or projective resolutions;
- cellular chain complexes;
- covering spaces and group actions.

Invariants:

- group homology and cohomology;
- cohomology rings;
- resolutions;
- cellular homology and cohomology;
- spectral-sequence data when the backend supports it.

Default route:

1. Identify group class and whether finite algorithms apply.
2. Check `H_1` against abelianization.
3. Record resolution length and whether it is proven complete.
4. Treat incomplete resolutions as partial evidence.

## Algebraic Geometry And Commutative Algebra

Use for polynomial rings, ideals, modules, quotient rings, affine/projective varieties, schemes, sheaves, and graded data.

Representations:

- base field and characteristic;
- polynomial variables and term order;
- ideal generators or module presentation;
- grading and saturation choices.

Invariants:

- dimension and degree;
- Hilbert series and Hilbert polynomial;
- free resolutions and Betti tables;
- radicals and primary decompositions;
- Ext, Tor, sheaf cohomology, and singularity indicators when supported.

Default route:

1. Fix base field, grading, and term order.
2. Use Groebner or standard bases for elimination, dimension, and Hilbert data.
3. Use specialized free-resolution or primary-decomposition routines when available.
4. Cross-check dimension and Hilbert data under changed term order when feasible.

## Toric, Polyhedral, And Semigroup Routes

Use for cones, affine monoids, lattice polytopes, toric ideals, binomial ideals, and semigroup rings.

Invariants:

- Hilbert basis;
- Hilbert series;
- lattice points;
- normalization;
- multiplicity, volume, and toric ideal data.

Default route:

1. Verify lattice, cone, and grading conventions.
2. Use Normaliz, polymake, OSCAR, Sage, or 4ti2 depending on installed tools.
3. Cross-check small polytopes by direct enumeration.

## Numerical Algebraic Geometry

Use when symbolic methods are infeasible for polynomial systems or components.

Representations:

- polynomial systems;
- homotopies;
- witness sets;
- parameterized systems.

Invariants:

- isolated roots;
- degrees;
- witness sets;
- component dimensions;
- certified nonsingular solutions when available.

Default route:

1. Prefer symbolic exact routes for small systems.
2. Use homotopy continuation for larger systems.
3. Require certification or interval/Krawczyk checks for final claims.
4. Treat uncertified numerical roots as evidence, not proof.
