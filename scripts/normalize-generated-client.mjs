// Normalizes generated client bundles for reproducible commits: replaces
// absolute upstream checkout paths in region comments, strips source-map
// references and trailing whitespace. Node.js port of normalize-generated-client.ps1.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fullPath, isMainModule } from './lib/build-util.mjs'

async function resolveJavaScriptFiles(inputPath) {
  const resolved = fullPath(inputPath)
  const entry = await stat(resolved)
  if (!entry.isDirectory()) return [resolved]
  const files = []
  const walk = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await walk(path)
      else if (item.isFile() && item.name.endsWith('.js')) files.push(path)
    }
  }
  await walk(resolved)
  return files
}

export function normalizeGeneratedClientText(original) {
  let content = original
  // Bundlers may retain the absolute checkout path in region comments. Keep
  // the upstream provenance while making committed artifacts reproducible and
  // safe to publish from any developer machine.
  content = content.replace(/[A-Z]:\\[^\r\n]*?\\\.research\\upstream\\deepseek-harness(?:-[^\\]+)?\\/gi, '<dsh-upstream>\\')
  // Official Linux CI also emits region provenance. Restrict normalization to
  // these comments, preserving executable strings and license attribution.
  content = content.replace(/^(\s*\/\/#?\s*region\s+(?:\\0dsh-css:)?)\/home\/runner\/work\/deepseek-harness\/deepseek-harness\//gm, '$1<dsh-upstream>/')
  content = content.replace(/^(\s*\/\/#?\s*region\s+(?:\\0dsh-css:)?)[A-Z]:[\\/][^\r\n]*?[\\/]eduwork-dsh-[a-f0-9]{12}[\\/]/gim, '$1<dsh-upstream>/')
  content = content.replace(/^\/\/# sourceMappingURL=.*?\s*$/gm, '')
  content = content.replace(/[ \t]+(?=\r?$)/gm, '')
  return content.replace(/[\r\n]+$/, '') + '\n'
}

export async function normalizeGeneratedClient(paths) {
  const files = []
  for (const inputPath of Array.isArray(paths) ? paths : [paths]) {
    files.push(...await resolveJavaScriptFiles(inputPath))
  }
  for (const file of [...new Set(files)].sort()) {
    const original = await readFile(file, 'utf8')
    const content = normalizeGeneratedClientText(original)
    if (content !== original) {
      await writeFile(file, content)
    }
  }
}

if (isMainModule(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: { path: { type: 'string', multiple: true } },
    allowPositionals: true,
  })
  const paths = [...(values.path ?? []), ...positionals]
  if (!paths.length) throw new Error('Use --path <file-or-directory> [...]')
  await normalizeGeneratedClient(paths)
}
