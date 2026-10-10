// Embed and verify the updater's asInvoker manifest without PowerShell.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isMainModule, isWindows } from '../../scripts/lib/build-util.mjs'
import { getResource, readPEResources, writePEResources } from '../../scripts/lib/windows-pe.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const sourceManifest = join(scriptRoot, 'updater.manifest')

export function assertInvokerManifest(bytes) {
  const xml = Buffer.from(bytes).toString('utf8')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<assembly\b/i.test(xml)) throw new Error('Invalid updater manifest')
  const levels = [...xml.matchAll(/<requestedExecutionLevel\b([^>]*)\/?\s*>/g)]
  if (levels.length !== 1 || !/\blevel="asInvoker"/.test(levels[0][1]) ||
      !/\buiAccess="false"/.test(levels[0][1])) {
    throw new Error('Updater manifest must request asInvoker with uiAccess=false')
  }
}

export async function setUpdaterManifest({ executable, verifyOnly = false } = {}) {
  if (!isWindows) throw new Error('Updater manifest resources require Windows')
  executable = fullPath(executable)
  const { executable: pe, resources } = await readPEResources(executable)
  if (!verifyOnly) {
    const bytes = await readFile(sourceManifest)
    assertInvokerManifest(bytes)
    resources.entries.splice(0, resources.entries.length,
      ...resources.entries.filter(entry => !(entry.type === 24 && entry.id === 1)))
    resources.entries.push({ type: 24, id: 1, lang: 0, codepage: 0,
      bin: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
    await writePEResources(executable, pe, resources)
  }
  const loaded = (await readPEResources(executable)).resources
  const manifests = getResource(loaded.entries, 24, 1)
  if (manifests.length !== 1) throw new Error('Updater has no unique embedded application manifest')
  for (const manifest of manifests) assertInvokerManifest(manifest.bin)
  console.log('Verified embedded updater manifest: asInvoker, uiAccess=false')
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { executable: { type: 'string' }, 'verify-only': { type: 'boolean' } } })
  if (!values.executable) throw new Error('Use --executable <exe> [--verify-only]')
  await setUpdaterManifest({ executable: values.executable, verifyOnly: Boolean(values['verify-only']) })
}
