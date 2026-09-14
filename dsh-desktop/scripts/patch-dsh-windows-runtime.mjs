// Reviewed deployment patch for the exact alpha.1/alpha.2 builds below. The upstream archive
// and source tarballs stay byte-for-byte original; this receipt identifies the
// one derived installed file. Remove when the upstream import is platform safe.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const reviewedBuilds = {
  '0.1.3-alpha.1': '27dc562911c13f22a5556931c52fb74699c21db1c5668841bffae2143bbcb7e1',
  '0.1.3-alpha.2': '0aec15b8ee1ae816633e58603b68a763f0957217a2115f3c83a989f4ecc28ca5',
}
const original = 'import { flock } from "fs-ext";'
const replacement = `import { createRequire as requirePOSIX } from "node:module";
// Windows uses the upstream Koffi kernel semaphore below; flock must never run.
const flock = process.platform === "win32"
  ? () => { throw new Error("POSIX flock must not run on Windows"); }
  : requirePOSIX(import.meta.url)("fs-ext").flock;`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function patchWindowsRuntime(runtime) {
  if (process.platform !== 'win32') return []
  const cli = JSON.parse(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  const beforeSHA256 = reviewedBuilds[cli.version]
  if (beforeSHA256 === undefined) return []
  const relative = 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js'
  const path = join(runtime, relative)
  const current = await readFile(path, 'utf8')
  // Idempotence still validates the entire original, not just a patch marker.
  const restored = current.includes(replacement) ? current.replace(replacement, original) : current
  if (hash(restored) !== beforeSHA256 || restored.split(original).length !== 2) {
    throw new Error('Unreviewed DSH JSONL backend: Windows compatibility patch refused')
  }
  const patched = restored.replace(original, replacement)
  const receipt = { id: `dsh-013-${cli.version.split('-')[1].replace('.', '')}-windows-posix-import`, file: relative, beforeSHA256, afterSHA256: hash(patched), platform: 'win32' }
  if (current !== patched) await writeFile(path, patched)
  await writeFile(join(runtime, '.chatecnu-dsh-compatibility-patches.json'), JSON.stringify({ schemaVersion: 1, patches: [receipt] }, null, 2) + '\n')
  return [receipt]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await patchWindowsRuntime(resolve(process.argv[2])), null, 2))
}
