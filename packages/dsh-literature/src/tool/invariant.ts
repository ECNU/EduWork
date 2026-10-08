/**
 * Package-owned invariant companion for `@eduwork/dsh-literature/tool`.
 * @module @eduwork/dsh-literature/tool/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@eduwork/dsh-literature/tool'

/** Cordis companion plugin name. */
export const name = 'tool-literature-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tools register schemas on `ctx.tools` and emit no package-owned
 * session event; the tool pipeline owns every result-observation contract.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
