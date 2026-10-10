// PE resource operations shared by the Windows Node.js build scripts.
// resedit is a locked, pure JavaScript build dependency installed on demand.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBundledCli } from './build-util.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../pe-resources')
const require = createRequire(join(packageRoot, 'package.json'))
let pending

export async function loadPELibrary() {
  pending ??= (async () => {
    let library
    try { library = require('resedit') } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
    if (library?.version !== '3.1.0') {
      await runBundledCli('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: packageRoot })
      library = require('resedit')
    }
    if (library.version !== '3.1.0') throw new Error('Locked PE resource editor version differs from the build lock')
    return library
  })()
  return pending
}

export async function readPEResources(file, { ignoreCert = false } = {}) {
  const library = await loadPELibrary()
  const executable = library.NtExecutable.from(await readFile(file), { ignoreCert })
  const resources = library.NtExecutableResource.from(executable)
  return { library, executable, resources }
}

export async function writePEResources(file, executable, resources) {
  resources.outputResource(executable)
  await writeFile(file, Buffer.from(executable.generate()))
}

export function getResource(entries, type, id) {
  return entries.filter(entry => entry.type === type && entry.id === id)
}
