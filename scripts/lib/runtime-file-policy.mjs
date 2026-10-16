// Based on DSH apps/desktop/scripts/runtime-file-policy.ts (dsh-v0.2.0-rc.2, MIT).
import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export function runtimeFileExclusion(path, target) {
  const parts = path.split('/')
  const file = parts.at(-1)
  if (/\.map$/iu.test(file)) return 'source map'
  if (/\.pdb$/iu.test(file)) return 'debug symbols'
  if (/\.pyc$/iu.test(file) || parts.includes('__pycache__')) return 'python bytecode'
  const container = parts.lastIndexOf('node_modules')
  if (container === -1) return undefined
  const packageParts = parts.slice(container + 1)
  const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
  const name = packageParts.slice(0, nameParts).join('/')
  const entry = packageParts.slice(nameParts).join('/')
  if (name !== 'typescript' && /\.d\.[cm]?ts$/u.test(file)) return 'TypeScript declaration'
  if (/\.tsbuildinfo$/u.test(file)) return 'TypeScript build cache'
  if (name.startsWith('@deepseek-ai/libreoffice-kit-') && name !== `@deepseek-ai/libreoffice-kit-${target}`) return 'LibreOffice other platform'
  if (name === 'fs-ext' && /^build\/(?:Release|Debug)\/(?:obj(?:\/|$)|fs_ext\.(?:exp|lib|pdb|iobj|ipdb)$)/u.test(entry)) return 'fs-ext compiler output'
  if (name === 'fs-ext' && /^build\/(?:binding\.sln|config\.gypi|fs_ext\.vcxproj(?:\.filters)?)$/u.test(entry)) return 'fs-ext build configuration'
  if (name === '@mixmark-io/domino' && (entry === 'test' || entry.startsWith('test/'))) return 'Domino test fixtures'
  if (name === 'node-pty' && entry.startsWith('prebuilds/')) {
    const platform = packageParts[nameParts + 1]
    if (platform !== undefined && platform !== target) return 'node-pty other platform'
  }
  if (name === '@koromix/koffi-win32-x64' && entry === 'win32_x64/koffi.lib') return 'Koffi import library'
  return undefined
}

export async function pruneRuntimeFiles(root, target) {
  const result = { files: 0, bytes: 0, reasons: {} }
  function record(reason, files, bytes) {
    result.files += files
    result.bytes += bytes
    const count = result.reasons[reason] ??= { files: 0, bytes: 0 }
    count.files += files
    count.bytes += bytes
  }
  async function removeDirectory(path, reason) {
    const count = { files: 0, bytes: 0 }
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const child = join(directory, entry.name)
        if (entry.isDirectory()) await collect(child)
        else if (entry.isFile()) {
          count.files++
          count.bytes += (await lstat(child)).size
        }
      }
    }
    await collect(path)
    await rm(path, { recursive: true })
    record(reason, count.files, count.bytes)
  }
  async function visit(directory, parent = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      const relative = parent ? `${parent}/${entry.name}` : entry.name
      const reason = runtimeFileExclusion(relative, target)
      if (entry.isDirectory()) {
        if (reason) await removeDirectory(path, reason)
        else await visit(path, relative)
      } else if (entry.isFile() && reason) {
        const { size } = await lstat(path)
        await rm(path)
        record(reason, 1, size)
      }
    }
  }
  await visit(root)
  return result
}
