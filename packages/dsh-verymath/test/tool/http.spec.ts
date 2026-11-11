import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHttp, withinWorkspace } from '../../src/http.ts'

// The browser panel can only show what these routes return, so they are the
// panel's real contract: a route that silently 500s or leaks a path outside the
// workspace is a panel that looks broken to the user.

const createdDirs: string[] = []

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verymath-http-'))
  createdDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const term = (overrides: Record<string, unknown> = {}) => ({
  term_id: 'manifold',
  en: 'manifold',
  cn: '流形',
  created_at: '2026-01-01',
  updated_at: '2026-01-02',
  ...overrides,
})

interface Registered {
  readonly path: string
  readonly fetch: (request: Request) => Promise<Response>
}

/** Capture the routes the plugin registers, without a real host connection. */
function mount(workspace: string, extras: { withWrite?: (path: string, task: () => Promise<unknown>) => Promise<unknown>, invalidate?: () => void } = {}): Map<string, Registered> {
  const routes = new Map<string, Registered>()
  const connection = {
    fetch: {
      register: (route: Registered) => {
        routes.set(route.path, route)
      },
    },
  }
  const ok = registerHttp({
    workspace: () => workspace,
    ...(extras.withWrite !== undefined ? { withWrite: extras.withWrite } : {}),
    ...(extras.invalidate !== undefined ? { invalidateGlossaryCache: extras.invalidate } : {}),
  }, connection)
  expect(ok).toBe(true)
  return routes
}

async function call(routes: Map<string, Registered>, path: string, query = ''): Promise<{ status: number, body: any }> {
  const route = routes.get(path.split('?')[0] ?? path)
  expect(route, `${path} is not registered`).toBeDefined()
  const response = await route!.fetch(new Request(`http://localhost${path}${query}`))
  return { status: response.status, body: await response.json() }
}


async function callPost(routes: Map<string, Registered>, path: string, payload: unknown): Promise<{ status: number, body: any }> {
  const route = routes.get(path)
  expect(route, `${path} is not registered`).toBeDefined()
  const response = await route!.fetch(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  return { status: response.status, body: await response.json() }
}

describe('withinWorkspace', () => {
  it('allows paths inside the workspace and rejects escapes', async () => {
    const workspace = await makeWorkspace()
    // macOS: /var is a symlink to /private/var, and the rule returns the resolved
    // path, so expectations are built from the resolved root.
    const root = await realpath(workspace)
    expect(await withinWorkspace(workspace, 'glossary/glossary.json')).toBe(join(root, 'glossary/glossary.json'))
    expect(await withinWorkspace(workspace, '../etc/passwd')).toBeUndefined()
    expect(await withinWorkspace(workspace, '/etc/passwd')).toBeUndefined()
  })

  it('rejects a symlink that points outside the workspace', async () => {
    // A lexical prefix check passes for ws/link/passwd when link -> /etc, so the
    // rule has to compare realpaths once the target exists.
    const workspace = await makeWorkspace()
    const outside = await makeWorkspace()
    await writeFile(join(outside, 'secret.json'), '[]')
    await symlink(outside, join(workspace, 'escape'))
    expect(await withinWorkspace(workspace, 'escape/secret.json')).toBeUndefined()
  })

  it('allows a not-yet-existing file inside the workspace', async () => {
    // Creating a new glossary is a legitimate write to a path that does not exist.
    const workspace = await makeWorkspace()
    const root = await realpath(workspace)
    expect(await withinWorkspace(workspace, 'glossary/new.json')).toBe(join(root, 'glossary/new.json'))
  })
})

describe('panel routes', () => {
  it('returns false when the host exposes no fetch table', () => {
    expect(registerHttp({ workspace: () => '/tmp' }, undefined)).toBe(false)
    expect(registerHttp({ workspace: () => '/tmp' }, {})).toBe(false)
  })

  it('registers every route the panel calls', async () => {
    const routes = mount(await makeWorkspace())
    for (const path of ['/api/verymath/env', '/api/verymath/glossaries', '/api/verymath/glossary', '/api/verymath/structures', '/api/verymath/paper', '/api/verymath/skills']) {
      expect(routes.has(path), path).toBe(true)
    }
  })

  it('probes the environment and reports a ready/total count', async () => {
    const routes = mount(await makeWorkspace())
    const { status, body } = await call(routes, '/api/verymath/env')
    expect(status).toBe(200)
    expect(Array.isArray(body.rows)).toBe(true)
    expect(body.rows.length).toBeGreaterThan(4)
    // python3 is present on any dev machine that runs this suite; the shape is
    // what matters: each row states what it unlocks and either a version or a hint.
    for (const row of body.rows) {
      expect(typeof row.id).toBe('string')
      expect(['ready', 'missing', 'partial']).toContain(row.state)
      expect(typeof row.enables).toBe('string')
      if (row.state !== 'ready') expect(typeof row.hint).toBe('string')
    }
    expect(typeof body.ready).toBe('number')
    expect(body.total).toBe(body.rows.length)
  }, 60_000)

  it('lists glossaries found in the workspace, skipping unparsable ones', async () => {
    const workspace = await makeWorkspace()
    await mkdir(join(workspace, 'glossary'), { recursive: true })
    await mkdir(join(workspace, 'broken'), { recursive: true })
    await writeFile(join(workspace, 'glossary', 'glossary.json'), JSON.stringify([term()]))
    await writeFile(join(workspace, 'broken', 'glossary.json'), 'not json')

    const routes = mount(workspace)
    const { body } = await call(routes, '/api/verymath/glossaries')
    expect(body.glossaries).toHaveLength(1)
    expect(body.glossaries[0]).toMatchObject({ path: 'glossary/glossary.json', terms: 1 })
  })

  it('queries one glossary and returns stats plus hits', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([
      term({ examples: [{ en: 'a smooth manifold', cn: '光滑流形' }] }),
      term({ term_id: 'group', en: 'group', cn: '群', field: ['代数学'] }),
      term({ term_id: 'manifold__1', en: 'manifold', cn: '多样体' }),
    ]))
    const routes = mount(workspace)

    const empty = await call(routes, '/api/verymath/glossary', '?path=glossary.json&q=')
    expect(empty.body.stats).toMatchObject({ total: 3, withExamples: 1, aliases: 1 })
    expect(empty.body.terms).toEqual([])

    const hit = await call(routes, '/api/verymath/glossary', '?path=glossary.json&q=manifold')
    expect(hit.body.matched).toBeGreaterThanOrEqual(2)
    expect(hit.body.terms[0]).toMatchObject({ en: 'manifold' })
    expect(hit.body.terms.some((entry: { term_id: string }) => entry.term_id === 'manifold__1')).toBe(true)

    const chinese = await call(routes, '/api/verymath/glossary', `?path=glossary.json&q=${encodeURIComponent('群')}`)
    expect(chinese.body.terms[0].matchedBy).toBe('cn')
  })

  it('rejects a glossary path outside the workspace', async () => {
    const routes = mount(await makeWorkspace())
    const { status, body } = await call(routes, '/api/verymath/glossary', '?path=../../../etc/passwd&q=x')
    expect(status).toBe(400)
    expect(body.error).toMatch(/escapes the workspace/)
  })

  it('reports a non-glossary file as a client error, not a 500', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), '{"nope":1}')
    const routes = mount(workspace)
    const { status, body } = await call(routes, '/api/verymath/glossary', '?path=glossary.json&q=x')
    expect(status).toBe(400)
    expect(body.error).toMatch(/not a valid glossary/)
  })

  it('returns a dependency graph with an inline SVG and topology digest', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'demo_structure.json'), JSON.stringify({
      paper: { title: 'Demo Paper', authors: ['A'] },
      main_theorems: [{ label: 'Theorem 1', statement: 'main' }],
      entities: [
        { type: 'DEFINITION', label: 'Definition 1', statement: 'def' },
        { type: 'LEMMA', label: 'Lemma 1', statement: 'aux', dependencies: ['Definition 1'] },
        { type: 'THEOREM', label: 'Theorem 1', statement: 'main', dependencies: ['Lemma 1'] },
      ],
    }))
    const routes = mount(workspace)

    const list = await call(routes, '/api/verymath/structures')
    expect(list.body.structures[0]).toMatchObject({ path: 'demo_structure.json', title: 'Demo Paper', entities: 3 })

    const graph = await call(routes, '/api/verymath/paper', '?path=demo_structure.json')
    expect(graph.status).toBe(200)
    expect(graph.body.entities).toBe(3)
    expect(graph.body.topDownOrder[0]).toBe('Theorem 1')
    expect(graph.body.metrics.find((metric: { label: string }) => metric.label === 'Definition 1')?.supportsMainTheorem).toBe(true)

    // The graph is returned as coordinates, not as a baked SVG: the client draws
    // it with real elements so a node can be clicked. Assert the layout is usable.
    expect(graph.body.graph.width).toBeGreaterThan(300)
    expect(graph.body.graph.nodes).toHaveLength(3)
    expect(graph.body.graph.nodes.map((node: { id: string }) => node.id).sort())
      .toEqual(['Definition 1', 'Lemma 1', 'Theorem 1'])
    for (const node of graph.body.graph.nodes) {
      expect(typeof node.x).toBe('number')
      expect(typeof node.y).toBe('number')
      expect(node.width).toBeGreaterThan(0)
      expect(typeof node.statement).toBe('string')
    }
    expect(graph.body.graph.edges).toHaveLength(2)
    expect(graph.body.graph.edges.map((edge: { from: string, to: string }) => `${edge.from}->${edge.to}`).sort())
      .toEqual(['Lemma 1->Definition 1', 'Theorem 1->Lemma 1'])

    const focused = await call(routes, '/api/verymath/paper', '?path=demo_structure.json&focus=Theorem%201')
    expect(focused.body.focus).toMatchObject({ found: true })
    expect(focused.body.focus.closure).toContain('Definition 1')
  })


  it('edits a term through the panel route and persists it', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([term()]))
    const routes = mount(workspace)

    const edited = await callPost(routes, '/api/verymath/glossary/upsert', {
      path: 'glossary.json',
      terms: [{ term_id: 'manifold', en: 'manifold', cn: '流形（几何）', pos: '名词' }],
    })
    expect(edited.status).toBe(200)
    expect(edited.body.updated).toEqual(['manifold'])
    expect(edited.body.stats.total).toBe(1)

    const onDisk = JSON.parse(await readFile(join(workspace, 'glossary.json'), 'utf8'))
    expect(onDisk[0]).toMatchObject({ term_id: 'manifold', cn: '流形（几何）', pos: '名词' })

    // The panel's write path must be readable by the query path immediately.
    const query = await call(routes, '/api/verymath/glossary', `?path=glossary.json&q=${encodeURIComponent('流形')}`)
    expect(query.body.terms[0].cn).toBe('流形（几何）')
  })

  it('adds a second translation as an alias row, not an overwrite', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([term()]))
    const routes = mount(workspace)

    const added = await callPost(routes, '/api/verymath/glossary/upsert', {
      path: 'glossary.json',
      terms: [{ en: 'manifold', cn: '多样体' }],
    })
    expect(added.body.added).toEqual(['manifold__1'])
    const onDisk = JSON.parse(await readFile(join(workspace, 'glossary.json'), 'utf8'))
    // Order-independent: the document is sorted by (en, cn) code point, and 多 < 流.
    expect(Object.fromEntries(onDisk.map((entry: { term_id: string, cn: string }) => [entry.term_id, entry.cn])))
      .toEqual({ manifold: '流形', manifold__1: '多样体' })
  })

  it('deletes a term and keeps idx contiguous', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([
      term(), term({ term_id: 'group', en: 'group', cn: '群' }),
    ]))
    const routes = mount(workspace)

    const removed = await callPost(routes, '/api/verymath/glossary/delete', { path: 'glossary.json', term_id: 'group' })
    expect(removed.status).toBe(200)
    expect(removed.body.stats.total).toBe(1)
    const onDisk = JSON.parse(await readFile(join(workspace, 'glossary.json'), 'utf8'))
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0].idx).toBe(1)

    const missing = await callPost(routes, '/api/verymath/glossary/delete', { path: 'glossary.json', term_id: 'nope' })
    expect(missing.status).toBe(404)
  })

  it('refuses panel writes outside the workspace and with no terms', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([term()]))
    const routes = mount(workspace)

    const escape = await callPost(routes, '/api/verymath/glossary/upsert', {
      path: '../../etc/glossary.json',
      terms: [{ en: 'x', cn: 'y' }],
    })
    expect(escape.status).toBe(400)
    expect(escape.body.error).toMatch(/escapes the workspace/)

    const empty = await callPost(routes, '/api/verymath/glossary/upsert', { path: 'glossary.json', terms: [] })
    expect(empty.status).toBe(400)
    expect(empty.body.error).toMatch(/non-empty array/)
  })

  it('surfaces a core write rejection as a 400, not a 500', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([term()]))
    const routes = mount(workspace)

    // A term_id that belongs to another English term is rejected by the core rules.
    const conflict = await callPost(routes, '/api/verymath/glossary/upsert', {
      path: 'glossary.json',
      terms: [{ term_id: 'manifold', en: 'morphism', cn: '态射' }],
    })
    expect(conflict.status).toBe(400)
    expect(conflict.body.error).toMatch(/English term/)
  })

  it('writes through the service lock and invalidates the service cache', async () => {
    // The panel must not keep a private lock chain: a panel write and a tool write
    // on the same document would interleave, and without invalidation the agent
    // keeps answering from the pre-write snapshot.
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'glossary.json'), JSON.stringify([term()]))
    const lockCalls: string[] = []
    let invalidations = 0
    const routes = mount(workspace, {
      withWrite: async (path, task) => {
        lockCalls.push(path)
        return await task()
      },
      invalidate: () => { invalidations += 1 },
    })

    const result = await callPost(routes, '/api/verymath/glossary/upsert', {
      path: 'glossary.json',
      terms: [{ term_id: 'manifold', en: 'manifold', cn: '流形（几何）' }],
    })
    expect(result.status).toBe(200)
    expect(lockCalls).toHaveLength(1)
    expect(lockCalls[0]).toContain('glossary.json')
    expect(invalidations).toBe(1)

    const removed = await callPost(routes, '/api/verymath/glossary/delete', { path: 'glossary.json', term_id: 'manifold' })
    expect(removed.status).toBe(200)
    expect(lockCalls).toHaveLength(2)
    expect(invalidations).toBe(2)
  })

  it('refuses a new file under a symlinked directory that escapes the workspace', async () => {
    // The target does not exist yet, so a realpath of the full path fails; the rule
    // has to resolve the deepest existing ancestor instead.
    const workspace = await makeWorkspace()
    const outside = await makeWorkspace()
    await symlink(outside, join(workspace, 'escape'))
    expect(await withinWorkspace(workspace, 'escape/new.json')).toBeUndefined()
  })

  it('lists the bundled skills with descriptions', async () => {
    const routes = mount(await makeWorkspace())
    const { body } = await call(routes, '/api/verymath/skills')
    expect(body.skills.length).toBe(16)
    const glossary = body.skills.find((skill: { name: string }) => skill.name === 'math-glossary')
    expect(glossary).toBeDefined()
    expect(glossary.description.length).toBeGreaterThan(10)
  })
})
