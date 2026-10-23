import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { bootThemeInjections } from '../upstream/packages/client/ui-theme/src/boot-theme.ts'
import { DEFAULT_PREFERENCE, isThemePreference } from '../upstream/packages/client/ui-theme/src/theme-settings.ts'
import { NATIVE_PROFILE_DIRECTORY } from './native-profile.mjs'

const THEME_ENTRY_ID = 'ui-theme'
const THEME_PACKAGE = '@deepseek-ai/dsh-client-ui-theme'

async function readPatches(path) {
  const text = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
  if (text === undefined) return []
  const patches = load(text, { schema: entryListSchema })
  if (!Array.isArray(patches)) throw new Error('Desktop theme preferences must be a patch list')
  return patches
}

export async function readStartupTheme(home) {
  try {
    const profile = join(home, 'profiles', NATIVE_PROFILE_DIRECTORY)
    const layers = await Promise.all([
      join(profile, 'node_modules/@eduwork/generated-profile/cordis.patch.yml'),
      join(profile, 'cordis.patch.yml'),
      join(home, 'cordis.patch.yml'),
    ].map(readPatches))
    const entries = applyEntryPatches([{ id: THEME_ENTRY_ID, name: THEME_PACKAGE, config: {} }], layers.flat(), () => {})
      .filter(entry => entry.id === THEME_ENTRY_ID)
    const entry = entries.length === 1 ? entries[0] : undefined
    const preference = entry?.name === THEME_PACKAGE && !entry.disabled ? entry.config?.preference : undefined
    return isThemePreference(preference) ? preference : DEFAULT_PREFERENCE
  } catch {
    console.warn('[startup-theme] startup theme preference unavailable; using system')
    // Host startup still owns configuration errors; early painting must not bypass its recovery.
    return DEFAULT_PREFERENCE
  }
}

export async function startupThemeResponse(response, home) {
  const [html, preference] = await Promise.all([response.text(), readStartupTheme(home)])
  const [style, script] = bootThemeInjections(preference)
  // Keep the Host readiness gate pending, and put the palette after the static stylesheet.
  const themed = html.replace('</head>', `<style>${style.text}</style></head>`)
    .replace(/<body(?:\s[^>]*)?>/iu, open => `${open}<script>${script.text}</script>`)
  return new Response(themed, { status: response.status, headers: response.headers })
}
