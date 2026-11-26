/**
 * Package-internal path resolution for bundled resources.
 * @module @eduwork/dsh-verymath/core
 */
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory of the compiled `core` module; bundled skills live at `../../skills`. */
const moduleDir = dirname(fileURLToPath(import.meta.url))

/** Resolve the bundled skills directory shipped inside the plugin package. */
export function bundledSkillsDir(): string {
  return normalize(join(moduleDir, '..', '..', 'skills'))
}
