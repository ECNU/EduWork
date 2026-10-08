import { compareVersions } from './content-update-protocol.mjs'
import { versionParts } from './release-policy.mjs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// API compatibility is independent of the exact artifacts selected by a build.
export const rebuiltDshPeerRange = '>=0.2.0-rc.2 <0.3.0-0'
export function isDsh020(version, minimum = '0.2.0-rc.1') {
  try {
    versionParts(version)
    const plain = version.split('+')[0]
    return compareVersions(plain, minimum) >= 0 && compareVersions(plain, '0.3.0-0') < 0
  } catch { return false }
}

// Institution plugins come from the edition repository under their own scope;
// the assembler marks them as distribution-owned explicitly.
export function rebuiltDshPeers(manifest, version, { editionOwned = false } = {}) {
  const owned = /^@(eduwork|chatecnu-work)\//.test(manifest.name ?? '') || editionOwned && /^@[a-z0-9-]+\/[a-z0-9._-]+$/.test(manifest.name ?? '') && !/^@deepseek-ai\//.test(manifest.name)
  if (!owned) throw Error('Only rebuilt distribution-owned plugins may project DSH peers')
  const [[major, minor]] = versionParts(version)
  const native020 = isDsh020(version, '0.2.0-rc.2')
  if (!native020 && (major !== 0 || minor !== 1)) throw Error('This DSH API series needs explicit compatibility qualification')
  // Historical 0.1 builds keep their previous contract; they are not certified
  // for another API by changing metadata in the current source checkout.
  const range = native020 ? rebuiltDshPeerRange : version
  return Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).map(([name, value]) =>
    [name, /^@deepseek-ai\/dsh(?:-|$)/.test(name) ? range : value]))
}

// Code-loading qualification remains exact. Keep feature decisions in the same
// row so an upgrade cannot silently lose defaults or restore a retired adapter.
const baselines = {
  '0.1.5-rc.2': { commit: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', native: false },
  '0.1.7-alpha.2': { commit: '00102833dfaee1da9f48a3a8eae9d34005a75218', native: true },
  '0.1.7-rc.2': { commit: '477b4f420553e8a52c2fbccc464d7561b239c443', native: true, configurableSubagents: true },
  '0.2.0-rc.2': { commit: '639ed015397290b3745d163aafe02ffee4aa3f84', native: true, configurableSubagents: true, upstreamReveal: true, migrateSchedule: true },
}
export function qualifiedDesktopBaseline(identity) {
  const baseline = Object.hasOwn(baselines, identity?.dshVersion) ? baselines[identity.dshVersion] : undefined
  return baseline && baseline.commit === identity.dshCommit ? { ...baseline } : undefined
}

// The legacy PowerShell assembler uses the same projection as Host installation.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { readFile, writeFile } = await import('node:fs/promises')
  const [path, version] = process.argv.slice(2)
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.peerDependencies = rebuiltDshPeers(manifest, version)
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
}
