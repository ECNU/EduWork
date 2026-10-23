import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Preserve the Host bootstrap preference until durable settings arrive.
// Apply only to copied Runtime bytes; retire when upstream adopts it at startup.
export const startupThemePatch = Object.freeze({
  id: 'startup-theme-preference-v1',
  package: '@deepseek-ai/dsh-client-ui-theme',
  version: '0.2.1-rc.2',
  file: 'lib/client.js',
  beforeSHA256: 'f9915fb53d5f156e75291e63be66c80e607a82bfd03c7d583e0a12ebef5a6cb8',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')

export function patchStartupThemeSource(input) {
  if (sha256(input) !== startupThemePatch.beforeSHA256) throw new Error('Startup theme input changed; review or retire the bootstrap adapter')
  const source = input.toString('utf8')
  const anchor = '\t\t\t\tthis.preference = DEFAULT_PREFERENCE;'
  if (source.split(anchor).length !== 2) throw new Error('Startup theme initialization anchor changed')
  return source.replace(anchor, `\t\t\t\tconst bootstrapPreference = typeof document === "undefined" ? undefined : document.documentElement.dataset.dsThemeSource;
\t\t\t\tthis.preference = isThemePreference(bootstrapPreference) ? bootstrapPreference : DEFAULT_PREFERENCE;`)
}

export async function patchStartupThemeRuntime(modules) {
  const root = join(modules, startupThemePatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== startupThemePatch.package || manifest.version !== startupThemePatch.version) throw new Error('Startup theme requires a newly qualified Runtime')
  const path = join(root, startupThemePatch.file)
  const output = patchStartupThemeSource(await readFile(path))
  await writeFile(path, output)
  return { ...startupThemePatch, afterSHA256: sha256(output) }
}
