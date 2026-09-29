import { readFileSync } from 'node:fs'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const ranges = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
describe('published peer API boundaries', () => {
  it.each(['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1'])('accepts %s without enumerating release candidates', version => {
    for (const [, range] of ranges) {
      expect(semver.satisfies(version, range as string)).toBe(true)
      expect(semver.satisfies(version, range as string, { includePrerelease: true })).toBe(true)
    }
  })
  it.each(['0.1.7-rc.2', '0.2.0-beta.2', '0.3.0-alpha.1', '0.3.0', '1.0.0'])('rejects incompatible series %s', version => {
    for (const [, range] of ranges) expect(semver.satisfies(version, range as string, { includePrerelease: true })).toBe(false)
  })
  it('records npm and upstream prerelease semantics separately', () => {
    for (const [, range] of ranges) {
      expect(semver.satisfies('0.2.1-rc.1', range as string)).toBe(false)
      expect(semver.satisfies('0.2.1-rc.1', range as string, { includePrerelease: true })).toBe(true)
    }
  })
})
