/**
 * VeryMath capability plugin for DSH — package entry.
 *
 * The bundle mounts three entries through `cordis.patch.yml`:
 * `./core` (the `ctx.verymath` service: glossary, paper, graph, gates, Sage),
 * `./tool` (the 14 model-facing tools), and this root module under its **bare
 * package name**. The root entry exists because the host resolves a client
 * plugin's package manifest from the loader entry name: with only `/core` and
 * `/tool` entries the specifier lookup returns undefined, so `dsh.client` is
 * never read and the browser bundle is never served. Its `apply` is therefore
 * the whole reason this module is mountable.
 *
 * This module also re-exports both halves so `import '@eduwork/dsh-verymath'`
 * gets the same surface as the subpaths.
 *
 * Upstream: VeryMath AI4Math repositories (MIT). See NOTICE.md and
 * UPSTREAM.json for per-repository provenance.
 *
 * @module @eduwork/dsh-verymath
 */
import type { Context } from '@deepseek-ai/cordis'

export * as core from './core/index.ts'
export * as tool from './tool/index.ts'

export const name = 'verymath-client'

/** The root entry needs no services of its own; it only anchors the client bundle. */
export const inject: string[] = []

/**
 * Mount point for the bare-name loader entry. Deliberately empty: the service and
 * the tools are mounted from `./core` and `./tool`, and the browser half is
 * served by the host from `dsh.client`. Keeping the function (rather than a
 * module without `apply`) means the host mounts an ordinary plugin instead of
 * warning about a module it cannot apply.
 */
export const apply = (_ctx: Context): void => {
  // Intentionally empty — see the doc comment above.
}
