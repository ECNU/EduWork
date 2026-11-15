import type { Context } from '@deepseek-ai/cordis'

/** Structural contract for the optional companion on older DSH hosts.
 * The main bundle never installs this service; rc.2 removed its npm package.
 * Keep the existing companion exports usable without pulling an old Cordis tree.
 */
interface LegacyInvariantService {
  register(name: string, install: () => void): (() => void) | Promise<() => void>
}

export function registerLegacyInvariant(ctx: Context, packageName: string): Promise<() => void> {
  const service = (ctx as Context & { invariants: LegacyInvariantService }).invariants
  return Promise.resolve(service.register(packageName, () => {}))
}
