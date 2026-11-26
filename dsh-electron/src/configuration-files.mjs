import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Paths belong to the desktop launch configuration, never to the renderer.
export async function openConfigurationFile(config, target, openPath, openAsText, openFallback) {
  if (!['config', 'examples'].includes(target)) throw new Error('Invalid configuration target')
  const path = target === 'config' ? config : join(dirname(config), 'examples')
  await access(path)
  // Respect the OS association, including its application chooser when needed.
  // Choosing an editor is interactive; do not substitute a fixed application.
  const error = await openPath(path)
  if (!error) return
  // macOS has no chooser for an unassociated .jsonc: fall back to the user's
  // default text editor rather than failing the button.
  if (target === 'config' && openAsText) return openAsText(path)
  // Linux distributions do not consistently register a handler for .jsonc.
  // Keep the system association as the first choice, then open the containing
  // directory so the user can choose an editor without a hard-coded one.
  if (target === 'config' && openFallback) {
    const fallbackError = await openFallback(dirname(path))
    if (!fallbackError) return
  }
  throw new Error(error)
}
