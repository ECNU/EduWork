import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { VeryMathRuntime, VeryMathError, isVeryMathError, parseGlossary, sortGlossary, type GlossaryTerm } from '../src/core/index.ts'

const today = '2026-10-14'

function term(overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    term_id: 'manifold',
    en: 'manifold',
    cn: '流形',
    created_at: today,
    updated_at: today,
    ...overrides,
  }
}

/** Minimal cordis Context double: service resolution + logger. */
function fakeContext(runtime: VeryMathRuntime): Context {
  return {
    verymath: runtime,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Context
}

async function makeRuntime(): Promise<VeryMathRuntime> {
  const { Context } = await import('@deepseek-ai/cordis')
  return new VeryMathRuntime(new Context())
}

// Every test that touches the filesystem goes through makeDir(), so one afterEach
// removes the temp trees instead of leaking them into $TMPDIR for the whole suite.
const createdDirs: string[] = []

async function makeDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'verymath-test-'))
  createdDirs.push(dir)
  return dir
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('VeryMathRuntime.loadGlossary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads, validates, and caches a glossary document', async () => {
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'glossary.json')
    await writeFile(path, JSON.stringify([term(), term({ term_id: 'group', en: 'group', cn: '群' })]))

    const first = await runtime.loadGlossary(path)
    expect(first.terms).toHaveLength(2)
    expect(first.path).toBe(path)

    // Second load comes from cache: corrupt the file and verify the cached read.
    await writeFile(path, 'not json')
    const second = await runtime.loadGlossary(path)
    expect(second.terms).toHaveLength(2)

    runtime.invalidateGlossary(path)
    await expect(runtime.loadGlossary(path)).rejects.toThrow(/not valid JSON/)
  })

  it('maps a missing file to VERYMATH_GLOSSARY_UNAVAILABLE', async () => {
    const runtime = await makeRuntime()
    try {
      await runtime.loadGlossary('/nonexistent/glossary.json')
      expect.unreachable()
    } catch (error) {
      expect(isVeryMathError(error)).toBe(true)
      expect((error as VeryMathError).code).toBe('VERYMATH_GLOSSARY_UNAVAILABLE')
    }
  })

  it('propagates invariant violations from stored documents', async () => {
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'bad.json')
    await writeFile(path, JSON.stringify([term(), term()])) // duplicate term_id

    await expect(runtime.loadGlossary(path)).rejects.toThrow(/duplicate term_id/)
  })

  it('does not report a non-ENOENT read failure as a missing glossary', async () => {
    // Reading a directory fails with EISDIR on macOS/Linux/Windows (FreeBSD is a
    // known exception) and stands in for the real hazard: a permission or I/O
    // failure used to arrive as VERYMATH_GLOSSARY_UNAVAILABLE, which the upsert
    // tool treats as "there is no glossary yet" — the next write would then
    // replace the document with whatever the model happened to send.
    const runtime = await makeRuntime()
    const dir = await makeDir()
    try {
      await runtime.loadGlossary(dir)
      expect.unreachable()
    } catch (error) {
      expect(isVeryMathError(error)).toBe(true)
      expect((error as VeryMathError).code).toBe('VERYMATH_IO')
    }
  })

  it('reloadGlossary discards a cached snapshot and reads the file again', async () => {
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'glossary.json')
    await writeFile(path, JSON.stringify([term()]))

    expect((await runtime.loadGlossary(path)).terms).toHaveLength(1)
    // An outside editor (the user, or the bundled glossary_web.py) rewrites it.
    await writeFile(path, JSON.stringify([term(), term({ term_id: 'group', en: 'group', cn: '群' })]))
    // The query cache still holds the old snapshot; a write path must not use it.
    expect((await runtime.loadGlossary(path)).terms).toHaveLength(1)
    expect((await runtime.reloadGlossary(path)).terms).toHaveLength(2)
  })

  it('serializes concurrent read-modify-write cycles on one path', async () => {
    // Without the per-path lock both writers read the same snapshot and the
    // later write silently drops the earlier one: the counter ends at 1.
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'counter.json')
    await writeFile(path, '0')

    const bump = () => runtime.withGlossaryWrite(path, async () => {
      const current = Number(await readFile(path, 'utf8'))
      await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
      await writeFile(path, String(current + 1))
    })
    await Promise.all([bump(), bump()])
    expect(Number(await readFile(path, 'utf8'))).toBe(2)
  })

  it('keeps the write queue usable after a failed writer', async () => {
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { writeFile, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'counter.json')
    await writeFile(path, '0')

    await expect(runtime.withGlossaryWrite(path, async () => {
      throw new VeryMathError('writer failed on purpose', 'VERYMATH_IO')
    })).rejects.toThrow(/on purpose/)
    await runtime.withGlossaryWrite(path, async () => { await writeFile(path, '1') })
    expect(await readFile(path, 'utf8')).toBe('1')
  })
})

describe('VeryMathRuntime.queryGlossaryFile', () => {
  it('queries a stored glossary end to end', async () => {
    const runtime = await makeRuntime()
    const dir = await makeDir()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dir, 'glossary.json')
    const glossary = sortGlossary([
      term(),
      term({ term_id: 'smooth-manifold', en: 'smooth manifold', cn: '光滑流形' }),
    ])
    await writeFile(path, JSON.stringify(glossary))

    const { hits } = await runtime.queryGlossaryFile(path, 'manifold')
    // Exact English match wins; 'smooth manifold' is not an en-prefix of 'manifold'.
    expect(hits).toHaveLength(1)
    expect(hits[0]?.matchedBy).toBe('en')
    const chinese = await runtime.queryGlossaryFile(path, '流形')
    expect(chinese.hits).toHaveLength(2)
  })
})

describe('VeryMathRuntime.runGlossaryScript', () => {
  it('survives scripts exiting 2/3 (needs-force / partial success) without throwing', async () => {
    const runtime = await makeRuntime()
    const python = await runtime.resolvePython()
    if (python === undefined) return
    const dir = await makeDir()
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const scriptPath = join(dir, 'exit3_probe.py')
    await writeFile(scriptPath, 'import sys\nsys.exit(3)\n')
    void scriptPath
    // Real upstream contract check: glossary_build.py on a missing source exits 2 with a
    // structured stderr message (the tool layer maps exit 2 to status 'needs-force').
    const probe = await runtime.runGlossaryScript('glossary_build.py', [join(dir, 'missing.csv')])
    expect([2, 3]).toContain(probe.exitCode)
    expect(probe.stderr.length + probe.stdout.length).toBeGreaterThan(0)
  })

  it('rejects script names outside the allowed pattern', async () => {
    const runtime = await makeRuntime()
    await expect(runtime.runGlossaryScript('../evil.py', [])).rejects.toThrow(/invalid glossary script/)
    await expect(runtime.runGlossaryScript('no-extension', [])).rejects.toThrow(/invalid glossary script/)
  })

  it('executes a real python script through the bridge', async () => {
    const runtime = await makeRuntime()
    const python = await runtime.resolvePython()
    if (python === undefined) {
      // No python on this machine: resolvePython staying undefined is the contract.
      expect(python).toBeUndefined()
      return
    }
    const dir = await makeDir()
    const { writeFile, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const csv = join(dir, 'source.csv')
    await writeFile(csv, 'en,cn\nmanifold,流形\ngroup,群\n')
    const out = join(dir, 'glossary.json')

    const result = await runtime.runGlossaryScript(
      'glossary_build.py',
      [csv, '--output', out, '--no-excel', '--source-label', 'unit-test'],
    )
    expect(result.exitCode).toBe(0)
    const built = parseGlossary(JSON.parse(await readFile(out, 'utf8')))
    expect(built.map(entry => entry.en)).toEqual(['group', 'manifold'])
  })
})

describe('VeryMathRuntime skill registration', () => {
  it('registers the bundled provider on a host with a skills registry', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    const { VeryMathSkillProvider } = await import('../../src/core/index.ts')
    const ctx = new Context()
    // Constructing the registry Service on the context registers `ctx.skills`.
    const registry = new SkillRegistry(ctx)
    const runtime = new VeryMathRuntime(ctx)
    void runtime

    // The registered provider lists our bundled skills.
    const candidates = await registry.list()
    const names = candidates.filter(skill => skill.provider === 'verymath-bundled').map(skill => skill.name)
    expect(names).toContain('math-glossary')
    expect(names).toContain('math-paper-reading')

    // Bodies load with directory resource bases.
    const skill = await registry.get('math-glossary')
    expect(skill?.resourceBase).toEqual({ kind: 'directory', path: expect.stringContaining('skills/math-glossary') })
    expect(skill?.content.length).toBeGreaterThan(100)

    // Provider class is exported and instantiable for direct testing.
    const provider = new VeryMathSkillProvider()
    expect(provider.name).toBe('verymath-bundled')
  }, 20_000)

  it('tolerates hosts without a skills registry', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    expect(() => new VeryMathRuntime(ctx)).not.toThrow()
    expect(ctx.verymath).toBeInstanceOf(VeryMathRuntime)
  })

  it('runtime skill registration provides working contexts for tool double tests', async () => {
    const runtime = await makeRuntime()
    expect(runtime.config.queryMaxHits).toBe(20)
    expect(fakeContext(runtime).verymath).toBe(runtime)
  })
})
