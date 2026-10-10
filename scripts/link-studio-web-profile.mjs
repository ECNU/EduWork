// Links the local Web profile's mutable module entries to the prepared
// assembly (junctions on Windows, directory symlinks elsewhere). Node.js port
// of link-studio-web-profile.ps1.
import { lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  fullPath, isDirectory, isFile, isMainModule, readJSON, writeJSON,
} from './lib/build-util.mjs'
import { symlinkType } from './lib/client-build.mjs'

const caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin'

function samePath(left, right) {
  if (caseInsensitivePaths) return left.toLowerCase() === right.toLowerCase()
  return left === right
}

function startsInside(owner, path) {
  const prefix = owner.replace(/[\\/]+$/, '') + (process.platform === 'win32' ? '\\' : '/')
  if (caseInsensitivePaths) return path.toLowerCase().startsWith(prefix.toLowerCase())
  return path.startsWith(prefix)
}

async function readLinkTarget(link) {
  const entry = await lstat(link).catch(() => null)
  if (!entry) return { exists: false }
  if (!entry.isSymbolicLink()) return { exists: true, target: null }
  let target = await readlink(link)
  // Windows junction targets come back absolute (sometimes \\?\-prefixed);
  // POSIX symlinks may be relative to the link's directory.
  target = target.replace(/^\\\\\?\\/, '')
  if (!isAbsolute(target)) target = resolve(dirname(link), target)
  return { exists: true, target: fullPath(target) }
}

export async function linkStudioWebProfile({ config, baseDirectory = process.cwd() } = {}) {
  const settings = await readJSON(config)
  baseDirectory = fullPath(baseDirectory)
  const home = resolve(baseDirectory, settings.home)
  const assembly = resolve(baseDirectory, settings.assembly)
  const profileName = settings.profileName ? String(settings.profileName) : 'chatecnu-work-web'
  if (!/^[a-z0-9-]+$/.test(profileName)) throw new Error('Invalid Web profile name.')
  const profile = fullPath(join(home, `profiles/${profileName}`))
  const modules = join(profile, 'node_modules')
  const runtime = fullPath(join(assembly, 'd/node_modules'))
  const identity = await readJSON(join(assembly, 'assembly.json'))
  // Only mutable module links to the prepared assembly; no source checkout links.
  const names = identity.kind === 'eduwork-web'
    ? ['@deepseek-ai', '@chatecnu-work', '@eduwork', '@shlv']
    : ['@deepseek-ai', '@chatecnu-work', ...Object.keys(identity.managedPackages ?? {})]
  const receiptPath = join(profile, '.eduwork-module-links.json')
  const receipt = await readJSON(receiptPath).catch(() => null)
  const planned = []
  const links = {}
  await mkdir(modules, { recursive: true })
  for (const name of names) {
    const link = fullPath(join(modules, name))
    const target = fullPath(join(runtime, name))
    if (!startsInside(modules, link) || !startsInside(runtime, target)) throw new Error('Profile module path escaped its owner.')
    if (!await isDirectory(target)) throw new Error(`Missing assembled package: ${name}`)
    await mkdir(dirname(link), { recursive: true })
    const existing = await readLinkTarget(link)
    if (existing.exists) {
      if (!existing.target) throw new Error(`Unexpected profile module entry: ${name}`)
      const previous = existing.target
      if (!samePath(previous, target)) {
        let managed = identity.kind === 'eduwork-web' && receipt?.schemaVersion === 1 && receipt?.links?.[name] === previous
        // Adopt pre-receipt links only when they point into another prepared
        // EduWork assembly. Never replace a real package directory or an
        // unrelated link; unlinking below never traverses its target.
        if (!managed && identity.kind === 'eduwork-web') {
          let previousModules = previous
          for (const segment of name.split(/[/\\]/)) previousModules = dirname(previousModules)
          const previousRuntime = dirname(previousModules)
          const previousAssembly = dirname(previousRuntime)
          const oldIdentity = join(previousAssembly, 'assembly.json')
          const runtimeMarker = join(previousRuntime, '.chatecnu-dsh-runtime.json')
          if (basename(previousModules) === 'node_modules' && basename(previousRuntime) === 'd' &&
              await isFile(oldIdentity) && await isFile(runtimeMarker)) {
            const old = await readJSON(oldIdentity)
            const marker = await readJSON(runtimeMarker)
            managed = old.kind === 'eduwork-web' && /^[a-f0-9]{40}$/.test(old.dshCommit ?? '') && Boolean(old.dshVersion) &&
              old.dshCommit === marker.dshCommit && old.dshVersion === marker.dshVersion
          }
        }
        if (!managed) throw new Error(`Unmanaged profile module link: ${name}. Keep its contents and resolve this entry before switching assemblies.`)
      }
      if (samePath(previous, target)) {
        links[name] = target
        continue
      }
    }
    planned.push({ link, target, replace: existing.exists })
    links[name] = target
  }
  // Validate the whole set before changing any link, so conflicts do not leave a
  // profile half-switched. Persist ownership for later moves and broken targets.
  for (const entry of planned) {
    if (entry.replace) await rm(entry.link, { force: true, recursive: false })
    await symlink(entry.target, entry.link, symlinkType)
  }
  if (identity.kind === 'eduwork-web') {
    await writeJSON(receiptPath, { schemaVersion: 1, links })
  }
  return links
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      'base-directory': { type: 'string' },
    },
  })
  if (!values.config) throw new Error('Use --config <settings.json> [--base-directory <dir>]')
  await linkStudioWebProfile({ config: values.config, baseDirectory: values['base-directory'] ?? process.cwd() })
}
