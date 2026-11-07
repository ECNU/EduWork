import { describe, expect, it } from 'vitest'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SKILLS_DIR = join(__dirname, '..', 'skills')

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === '.ruff_cache' || entry.name === '__pycache__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    const info = await stat(full)
    if (info.isDirectory()) files.push(...(await walk(full, base)))
    else files.push(full)
  }
  return files
}

describe('bundled skills hygiene (ported from upstream test_course_skills)', () => {
  it('contains no machine-local paths or secret placeholders in skill files', async () => {
    const files = await walk(SKILLS_DIR)
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      if (!/\.(md|py|yaml|yml|json|txt)$/.test(file)) continue
      const content = await readFile(file, 'utf8')
      if (/\/Users\//.test(content) || /\/home\//.test(content)) offenders.push(`${file}: machine-local path`)
      if (/\b(sk-[A-Za-z0-9]{8,}|API_KEY\s*=\s*["'][^"']+["'])/.test(content)) offenders.push(`${file}: secret literal`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps skill directories free of tool caches', async () => {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const children = await readdir(join(SKILLS_DIR, entry.name))
      expect(children).not.toContain('.ruff_cache')
      expect(children).not.toContain('__pycache__')
    }
  })
})
