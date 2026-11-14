/**
 * Package-owned invariant companion for `@eduwork/dsh-literature/arxiv`.
 * @module @eduwork/dsh-literature/arxiv/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import { registerLegacyInvariant } from '../legacy-invariant.ts'

const PACKAGE_NAME = '@eduwork/dsh-literature/arxiv'

/** Cordis companion plugin name. */
export const name = 'literature-arxiv-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this source exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  registerLegacyInvariant(ctx, PACKAGE_NAME)
/* jscpd:ignore-end */
