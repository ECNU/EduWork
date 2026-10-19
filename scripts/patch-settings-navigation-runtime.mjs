import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { settingsNavigationIcon } from './settings-navigation-icons.mjs'

// Apply to the copied product only. Retire when upstream exposes a section
// icon extension point; do not fork the settings renderer or change plugin IDs.
export const settingsNavigationPatch = Object.freeze({
  id: 'settings-navigation-icons-v1',
  package: '@deepseek-ai/dsh-client-ui-settings-general',
  version: '0.2.1-rc.2',
  file: 'lib/client.js',
  beforeSHA256: 'fb6c8d32d1994454578caa31cc975575a789e11f0afd6d3c19fe769f47050f7e',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')
export function patchSettingsNavigationSource(input) {
  if (sha256(input) !== settingsNavigationPatch.beforeSHA256) throw new Error('Settings navigation input changed; review or retire the icon adapter')
  const anchor = 'function navIcon(id) {'
  const source = input.toString('utf8')
  if (source.split(anchor).length !== 2) throw new Error('Settings navigation anchor changed')
  return source.replace(anchor, `${settingsNavigationIcon.toString()}\n${anchor}
    const productIcon = settingsNavigationIcon(id, react_jsx_runtime.jsx, react_jsx_runtime.jsxs,
      _deepseek_ai_dsh_client_ui_primitives, SettingsRoot_module_css_default.navIcon);
    if (productIcon !== null) return productIcon;`)
}
export async function patchSettingsNavigationRuntime(modules) {
  const root = join(modules, settingsNavigationPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== settingsNavigationPatch.package || manifest.version !== settingsNavigationPatch.version) throw new Error('Settings navigation requires a newly qualified Runtime')
  const path = join(root, settingsNavigationPatch.file)
  const output = patchSettingsNavigationSource(await readFile(path))
  await writeFile(path, output)
  return { ...settingsNavigationPatch, afterSHA256: sha256(output) }
}
