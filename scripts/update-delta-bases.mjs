// Earlier stable releases that a new stable release patches. The release
// workflow downloads their archives before the build; the build reads only the
// local files.
import { createWriteStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { compareVersions } from '../dsh-host/content-update-protocol.mjs'
import { desktopVersion } from './desktop-build-plan.mjs'
import { ensureDir, fullPath, isMainModule, sha256File } from './lib/build-util.mjs'

const archivePlatforms = { windows: 'windows-x64', macos: 'macos-arm64' }

// Patches come from the three latest earlier stable releases; older
// installations download the full archive.
export function previousStableArchives(releases, { product, version, platform }) {
  if (desktopVersion(version).prerelease) return []
  return releases
    .filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name))
    .map(release => ({ from: release.tag_name.slice(1), assets: release.assets }))
    .filter(({ from }) => compareVersions(from, version) < 0)
    .sort((a, b) => compareVersions(b.from, a.from))
    .slice(0, 3)
    .map(({ from, assets }) => {
      const name = `${product}-${from}-${archivePlatforms[platform]}-electron.zip`
      const asset = assets.find(asset => asset.name === name)
      if (!/^sha256:[a-f0-9]{64}$/.test(asset?.digest ?? '')) throw new Error(`Release ${from} has no ${platform} archive with a digest`)
      return { name, url: asset.browser_download_url, sha256: asset.digest.slice('sha256:'.length) }
    })
}

// The archives the workflow downloaded into `directory`.
export async function deltaBaseArchives(directory, version) {
  if (!directory) return []
  const bases = (await readdir(directory)).filter(file => file.endsWith('.zip')).sort().map(file => join(fullPath(directory), file))
  if (bases.length && desktopVersion(version).prerelease) throw new Error('Delta updates are generated for stable releases only')
  return bases
}

if (isMainModule(import.meta.url)) {
  const [repository, product, version, platform, output] = process.argv.slice(2)
  if (!output || !archivePlatforms[platform]) throw new Error('Use update-delta-bases.mjs <owner/repository> <product> <version> <windows|macos> <output directory>')
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) },
  })
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`)
  await ensureDir(output)
  for (const archive of previousStableArchives(await response.json(), { product, version, platform })) {
    const file = join(output, archive.name), download = await fetch(archive.url)
    if (!download.ok) throw new Error(`Download failed (${download.status}): ${archive.url}`)
    await pipeline(Readable.fromWeb(download.body), createWriteStream(file))
    if (await sha256File(file) !== archive.sha256) throw new Error(`Digest mismatch: ${archive.name}`)
    console.log(`Downloaded ${archive.name}`)
  }
}
