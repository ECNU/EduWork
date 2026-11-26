import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const manifest = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as {
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

const dshPeers = [
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-tools',
] as const

describe('DSH peer manifest', () => {
  it('pins the current EduWork runtime and still admits older supported peers', () => {
    for (const name of dshPeers) {
      const range = manifest.peerDependencies[name]
      expect(range, name).toBeDefined()
      expect(manifest.devDependencies[name], `${name} development pin`).toBe('0.2.2-rc.3')
      expect(satisfies('0.2.2-rc.1', range!), `${name} @ 0.2.2-rc.1`).toBe(true)
      expect(satisfies('0.2.2-rc.3', range!), `${name} @ 0.2.2-rc.3`).toBe(true)
      expect(satisfies('0.2.2-rc.5', range!), `${name} @ 0.2.2-rc.5`).toBe(true)
    }
  })

  it('still excludes the pre-0.2.1 and 0.3 boundaries', () => {
    for (const name of dshPeers) {
      const range = manifest.peerDependencies[name]!
      expect(satisfies('0.2.0', range), `${name} @ 0.2.0`).toBe(false)
      expect(satisfies('0.3.0', range), `${name} @ 0.3.0`).toBe(false)
    }
  })
})
