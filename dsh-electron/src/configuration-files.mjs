import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Paths belong to the desktop launch configuration, never to the renderer.
export async function openConfigurationFile(config, target, openPath) {
  if (!['config', 'examples'].includes(target)) throw new Error('Invalid configuration target')
  const path = target === 'config' ? config : join(dirname(config), 'examples')
  await access(path)
  // Respect the OS association, including its application chooser when needed.
  // Choosing an editor is interactive; do not substitute a fixed application.
  const error = await openPath(path)
  if (error) throw new Error(error)
}
