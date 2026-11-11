/**
 * VeryMath capability plugin for DSH — package entry.
 *
 * The bundle mounts three entries through `cordis.patch.yml`:
 * `./core` (the `ctx.verymath` service: glossary, paper, graph, gates, Sage),
 * `./tool` (the 14 model-facing tools), and this root module under its **bare
 * package name**. The root entry exists because the host resolves a client
 * plugin's package manifest from the loader entry name: with only `/core` and
 * `/tool` entries the specifier lookup returns undefined, so `dsh.client` is
 * never read and the browser bundle is never served.
 *
 * It also registers the routes that back the browser panel (see `./http`), so the
 * panel and the chat tools read one implementation of the same logic.
 *
 * Upstream: VeryMath AI4Math repositories (MIT). See NOTICE.md and
 * UPSTREAM.json for per-repository provenance.
 *
 * @module @eduwork/dsh-verymath
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerHttp, type ConnectionLike } from './http.ts'

export * as core from './core/index.ts'
export * as tool from './tool/index.ts'

export const name = 'verymath-client'

/** `connection` is optional on purpose: see the apply comment. */
export const inject: string[] = []

/**
 * Shape of the workspace registry as far as this module reads it: a map of
 * records that each carry the canonical directory.
 */
interface WorkspaceRegistryLike {
  readonly entities?: Map<string, { readonly path?: unknown }>
}

/**
 * Look up an optional host service. The cast is explained where it happens.
 */
function optionalService<T>(ctx: Context, service: string): T | undefined {
  // SAFETY: `Context.get` is typed by the cordis service map of the host build,
  // which this package does not import (the workspace registry lives in an
  // optional host package). The cast only narrows an `unknown` that every caller
  // re-checks field by field, so nothing is treated as more than the fields read.
  return (ctx as unknown as { get: (name: string) => unknown }).get(service) as T | undefined
}

/**
 * The workspace the panel browses.
 *
 * Preferred source is the host's `workspaceRegistry` (each record carries the
 * canonical directory); when that service is absent — a different host build, or
 * a headless run — fall back to the process cwd. The resolved root is returned to
 * the panel so the user can see which directory it reads instead of wondering why
 * a glossary is "missing".
 */
function resolveWorkspace(ctx: Context): string {
  const registry = optionalService<WorkspaceRegistryLike>(ctx, 'workspaceRegistry')
  const entities = registry?.entities
  if (entities instanceof Map) {
    for (const entity of entities.values()) {
      const path = entity?.path
      if (typeof path === 'string' && path.length > 0) return path
    }
  }
  return process.cwd()
}

/**
 * Mount point for the bare-name loader entry.
 *
 * It registers the panel's HTTP routes and nothing else: the service and the
 * tools are mounted from `./core` and `./tool`, and the browser half is served by
 * the host from `dsh.client`.
 *
 * `connection` is looked up with `ctx.inject`, not `ctx.get`: at apply time the
 * service may not exist yet, and a `ctx.get` that quietly returns undefined
 * leaves every route unregistered — the panel then shows 404 for all of them.
 */
export const apply = (ctx: Context): void => {
  ctx.inject(['connection'], (inner) => {
    const connection = optionalService<ConnectionLike>(inner, 'connection')
    registerHttp({
      workspace: () => resolveWorkspace(inner),
      log: (message: string) => inner.logger?.warn?.(message),
    }, connection)
  })
}
