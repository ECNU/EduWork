import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Remotion's bundler loads its rspack configuration at startup although Studio
// bundles with webpack. Loading it on first rspack use lets the product omit
// rspack. Retire this patch with a Remotion release that loads rspack lazily.
export const remotionBundlerPatch = Object.freeze({
  id: 'remotion-bundler-lazy-rspack-v1',
  package: '@remotion/bundler',
  version: '4.0.520',
  files: Object.freeze({
    'dist/index.js': 'eafd656ea5ddb110070037f9b6a5717722117269634f38f62ecbfc8ad195fbb8',
    'dist/bundle.js': 'bc9a6e1ecabe0b185a9f04322930cf240f22fce7d8eaba4b66fbe6e8b7a14f23',
  }),
})
const sha256 = value => createHash('sha256').update(value).digest('hex')
const edits = {
  'dist/index.js': [
    ['const rspack_config_1 = require("./rspack-config");\n', ''],
    ['    rspackConfig: rspack_config_1.rspackConfig,', '    rspackConfig: (...args) => require("./rspack-config").rspackConfig(...args),'],
    ['    createRspackCompiler: rspack_config_1.createRspackCompiler,', '    createRspackCompiler: (...args) => require("./rspack-config").createRspackCompiler(...args),'],
  ],
  'dist/bundle.js': [
    ['const rspack_config_1 = require("./rspack-config");\n', ''],
    ['return (0, rspack_config_1.rspackConfig)(configArgs);', 'return require("./rspack-config").rspackConfig(configArgs);'],
  ],
}

export function patchRemotionBundlerSource(file, input) {
  if (sha256(input) !== remotionBundlerPatch.files[file]) {
    throw new Error(`Remotion bundler input changed: ${file}; review or retire the patch for the new Runtime`)
  }
  let output = input.toString('utf8')
  for (const [before, after] of edits[file]) {
    if (output.split(before).length !== 2) throw new Error(`Unexpected Remotion bundler patch site in ${file}`)
    output = output.replace(before, after)
  }
  return output
}

export async function patchRemotionBundlerRuntime(modules) {
  const root = join(modules, remotionBundlerPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== remotionBundlerPatch.package || manifest.version !== remotionBundlerPatch.version) {
    throw new Error('Remotion bundler patch requires a newly qualified Runtime')
  }
  const receipts = []
  for (const [file, beforeSHA256] of Object.entries(remotionBundlerPatch.files)) {
    const output = patchRemotionBundlerSource(file, await readFile(join(root, file)))
    await writeFile(join(root, file), output)
    const { id, package: name, version } = remotionBundlerPatch
    receipts.push({ id, package: name, version, file, beforeSHA256, afterSHA256: sha256(output) })
  }
  return receipts
}
