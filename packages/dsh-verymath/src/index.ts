/**
 * VeryMath capability plugin for DSH — package entry.
 *
 * The bundle mounts two modules through `cordis.patch.yml`:
 * `./core` (the `ctx.verymath` service: glossary, paper, graph, gates, Sage)
 * and `./tool` (the 14 model-facing tools). This module re-exports both so a
 * host that imports the package root gets the same surface as the subpaths.
 *
 * Upstream: VeryMath AI4Math repositories (MIT). See NOTICE.md and
 * UPSTREAM.json for per-repository provenance.
 *
 * @module @eduwork/dsh-verymath
 */
export * as core from './core/index.ts'
export * as tool from './tool/index.ts'
