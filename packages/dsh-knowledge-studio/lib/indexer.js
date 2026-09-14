import { relative, sep } from 'node:path'
import { isSupportedDocumentPath, isSupportedPdfPath } from './parser.js'
import { parsePdfBytes } from './pdf.js'

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.dsh', '.studio', '.artifacts', '.ecnu-agent',
  'node_modules', '.venv', 'venv', '__pycache__', 'site-packages',
  '.tox', '.nox', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'dist', 'build', 'coverage', '.next', '.nuxt', '.cache',
])

// Dependency lockfiles are reproducibility metadata rather than useful workspace
// evidence. Their large, machine-generated bodies can otherwise dominate the
// initial index while adding almost no value to Agent retrieval.
const DEFAULT_IGNORED_FILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml',
  'yarn.lock', 'bun.lock', 'bun.lockb',
])

function displayRelative(rootProcessPath, targetProcessPath) {
  const value = relative(rootProcessPath, targetProcessPath)
  return value.split(sep).join('/')
}

export async function scanWorkspace(fileSystem, workspace, {
  signal,
  maxTextFileBytes = 1024 * 1024,
  maxPdfFileBytes = 64 * 1024 * 1024,
  maxFiles = 20_000,
  maxReadDocuments = Infinity,
  pathPrefix = '',
  ignoredDirectories = DEFAULT_IGNORED_DIRECTORIES,
  ignoredFiles = DEFAULT_IGNORED_FILES,
  manifest = [],
  indexVersion = 2,
  onProgress,
} = {}) {
  const rootTarget = await fileSystem.resolve(workspace.path, { signal })
  const rootInfo = await fileSystem.stat(rootTarget, signal)
  if (rootInfo?.type !== 'directory') throw new Error(`Workspace directory is unavailable: ${workspace.path}`)
  const rootProcessPath = fileSystem.processPath(rootTarget)
  const documents = []
  const presentPaths = []
  const unchangedPaths = []
  const knownByPath = new Map(manifest.map(entry => [String(entry.path).replaceAll('\\', '/'), entry]))
  const skipped = { unsupported: 0, tooLarge: 0, symlink: 0, outside: 0, unreadable: 0 }
  const stack = [{ target: rootTarget, processPath: rootProcessPath }]
  let discovered = 0

  scan: while (stack.length > 0) {
    if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
    const current = stack.pop()
    const entries = await fileSystem.listDir(current.target, signal)
    if (entries.some(item => ['pyvenv.cfg', 'python.exe', 'python3.exe'].includes(item.name.toLowerCase()))) continue
    for (const entry of entries) {
      if (!fileSystem.contains(rootTarget, entry.target)) {
        skipped.outside += 1
        continue
      }
      const entryProcessPath = fileSystem.processPath(entry.target)
      const path = displayRelative(rootProcessPath, entryProcessPath)
      if (pathPrefix && path !== pathPrefix && !path.startsWith(pathPrefix + '/') && !(entry.type === 'directory' && pathPrefix.startsWith(path + '/'))) continue
      const pathInfo = await fileSystem.lstat(entry.name, { cwd: current.processPath }, signal).catch(() => undefined)
      if (pathInfo?.type === 'symlink') {
        skipped.symlink += 1
        continue
      }
      if (entry.type === 'directory') {
        // Detect Python runtimes without discarding sibling attachments.
        const managedEnvironment = /(?:^|\/)\.[^/]+\/environments(?:\/|$)/i.test(path)
        if (!managedEnvironment && !ignoredDirectories.has(entry.name.toLowerCase())) stack.push({ target: entry.target, processPath: entryProcessPath })
        continue
      }
      if (ignoredFiles.has(entry.name.toLowerCase())) {
        skipped.unsupported += 1
        continue
      }
      if (entry.type !== 'file' || !isSupportedDocumentPath(path)) {
        skipped.unsupported += 1
        continue
      }
      discovered += 1
      if (discovered > maxFiles) throw new Error(`Workspace contains more than ${maxFiles} supported files; narrow the workspace or raise maxFiles`)
      const info = entry.version ? entry : await fileSystem.stat(entry.target, signal)
      if (!info || info.type === 'other' || info.type === 'directory') continue
      const pdf = isSupportedPdfPath(path)
      const sizeLimit = pdf ? maxPdfFileBytes : maxTextFileBytes
      if (typeof info.size === 'number' && info.size > sizeLimit) {
        skipped.tooLarge += 1
        continue
      }
      presentPaths.push(path)
      const version = String(info.version)
      const known = knownByPath.get(path)
      if (known?.version === version && Number(known.indexVersion) === Number(indexVersion)) {
        unchangedPaths.push(path)
        onProgress?.({ phase: 'scan', processed: discovered, total: null, path })
        continue
      }
      try {
        if (pdf) {
          const bytes = await fileSystem.readBytes(entry.target, signal, sizeLimit)
          const parsed = await parsePdfBytes({ path, bytes })
          if (parsed.sections.length === 0) throw new Error('PDF contains no extractable text')
          documents.push({ path, version, size: info.size, parsed })
        } else {
          const text = await fileSystem.readText(entry.target, signal)
          documents.push({ path, version, size: info.size, text })
        }
        onProgress?.({ phase: 'scan', processed: discovered, total: null, path })
        if (documents.length >= maxReadDocuments) break scan
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error
        skipped.unreadable += 1
      }
    }
  }

  documents.sort((left, right) => left.path.localeCompare(right.path))
  presentPaths.sort((left, right) => left.localeCompare(right))
  unchangedPaths.sort((left, right) => left.localeCompare(right))
  return { documents, presentPaths, unchangedPaths, discovered, skipped }
}

export { DEFAULT_IGNORED_DIRECTORIES, DEFAULT_IGNORED_FILES }
