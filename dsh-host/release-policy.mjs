import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export function versionParts(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  if (!match || match[4]?.split('.').some(value => /^0\d+$/.test(value))) throw Error('无效的 SemVer 版本号')
  return [match.slice(1, 4).map(Number), match[4]?.split('.')]
}

// Publication status belongs to EduWork. An upstream RC does not make an
// EduWork release a developer build; it currently makes it a public beta.
export function releaseIdentity(version, dshVersion) {
  const [, prerelease] = versionParts(version)
  const [, upstreamPrerelease] = versionParts(dshVersion)
  const development = Boolean(prerelease)
  const stage = development ? 'development' : upstreamPrerelease ? 'public-beta' : 'stable'
  return { version, dshVersion, stage, publishable: !development,
    badge: { zh: development ? '开发版' : upstreamPrerelease ? '公测版' : '正式版',
      en: development ? 'DEV' : upstreamPrerelease ? 'PUBLIC BETA' : 'RELEASE' } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(releaseIdentity(process.argv[2], process.argv[3])))
}
