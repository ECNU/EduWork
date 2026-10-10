// Installs the release-owned desktop configuration examples and brand assets
// into a desktop product tree. Node.js port of install-desktop-config.ps1.
import { open, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { copyFileTo, copyTree, ensureDir, fullPath, isDirectory, isFile, isMainModule, pathExists } from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function installDesktopConfig({ output, defaultConfig = '' } = {}) {
  const source = fullPath(join(scriptRoot, '../config/desktop'))
  if (!defaultConfig) defaultConfig = join(source, 'eduwork.jsonc')
  defaultConfig = fullPath(defaultConfig)
  if (!await isFile(defaultConfig)) throw new Error('The selected default desktop configuration is missing')
  const destination = join(fullPath(output), 'config')
  const brand = join(fullPath(output), 'resources/brand')
  await ensureDir(brand)
  for (const asset of ['icon.svg', 'icon-32.png', 'icon-256.png', 'icon.ico', 'tray-black.png', 'tray-white.png']) {
    await copyFileTo(join(scriptRoot, `../assets/eduwork/${asset}`), join(brand, asset))
  }
  await ensureDir(destination)
  // Examples are release-owned documentation; the active config and user assets are not.
  await copyTree(join(source, 'examples'), join(destination, 'examples'))
  const editionExamples = join(dirname(defaultConfig), 'examples')
  if (await isDirectory(editionExamples) && editionExamples !== join(source, 'examples')) {
    for (const entry of await readdir(editionExamples, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonc')) continue
      await copyFileTo(join(editionExamples, entry.name), join(destination, 'examples', entry.name))
    }
  }
  const config = join(destination, 'eduwork.jsonc')
  if (!await pathExists(config)) {
    // Exclusive creation also preserves a file created concurrently by the user.
    const handle = await open(config, 'wx')
    try {
      await handle.write(await readFile(defaultConfig))
    } finally {
      await handle.close()
    }
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      'default-config': { type: 'string' },
    },
  })
  if (!values.output) throw new Error('Use --output <product> [--default-config <eduwork.jsonc>]')
  await installDesktopConfig({ output: values.output, defaultConfig: values['default-config'] ?? '' })
}
