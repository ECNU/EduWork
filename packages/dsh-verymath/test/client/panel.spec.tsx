// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'

// The browser half is a CJS bundle for the DSH module loader, so the only way to
// prove the panel actually renders is to load it the way the host does and drive
// it with real DOM events. Clicking through the running app is not reproducible
// (and on this machine it competes with other windows), so the render test is the
// regression gate: every tab has to mount, switch, and show what its route
// returned.

const BUNDLE = join(__dirname, '..', '..', 'client', 'verymath.js')

interface Registration {
  readonly slot: string
  readonly component: (props?: Record<string, unknown>) => unknown
}

function loadPanel(): (props?: Record<string, unknown>) => unknown {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry: { id: string, factory: (req: (name: string) => unknown) => Record<string, unknown> } | undefined
  const fakeWindow = { __ModuleLoader__: { load: (loaded: typeof entry) => { entry = loaded } } }
  // eslint-disable-next-line no-new-func
  new Function('window', code)(fakeWindow)
  if (entry === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
  const exports = entry.factory((name: string) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })

  const registrations: Registration[] = []
  const ctx = {
    slots: {
      inject: (_slot: string, callback: () => unknown) => { callback(); return () => undefined },
      register: (options: Record<string, unknown>, component: Registration['component']) => {
        registrations.push({ slot: String(options.name), component })
        return () => undefined
      },
    },
    effect: (callback: () => unknown) => { callback(); return () => undefined },
  }
  ;(exports.apply as (ctx: unknown) => void)(ctx)
  const panel = registrations.find((item) => item.slot === 'main')
  if (panel === undefined) throw new Error('bundle did not register the main panel')
  return panel.component
}

const ENV_BODY = {
  ready: 5,
  total: 7,
  workspace: '/tmp/demo-workspace',
  rows: [
    { id: 'python', label: 'Python 3', enables: '术语库构建', state: 'ready', detail: 'Python 3.14.7' },
    { id: 'sage', label: 'SageMath', enables: '本机 Sage 执行', state: 'missing', hint: 'conda create -n sage sage=10.9' },
  ],
}

const GLOSSARY_BODY = {
  stats: {
    total: 3, withExamples: 1, aliases: 1, fields: ['代数学'],
    missingExamples: ['manifold'], missingField: ['cohomology'],
    missingExampleCount: 1, missingFieldCount: 1,
  },
  matched: 2,
  truncated: false,
  terms: [
    { term_id: 'manifold', en: 'manifold', cn: '流形', matchedBy: 'en', pos: '名词', field: ['拓扑学'], examples: [{ en: 'a smooth manifold', cn: '光滑流形' }] },
    { term_id: 'manifold__1', en: 'manifold', cn: '多样体', matchedBy: 'en' },
  ],
}

const PAPER_BODY = {
  title: 'Demo Paper',
  entities: 2,
  sharedNodes: [],
  cycles: [],
  isolated: [],
  longestChain: ['Theorem 1', 'Lemma 1'],
  topDownOrder: ['Theorem 1', 'Lemma 1'],
  bottomUpLevels: [['Lemma 1'], ['Theorem 1']],
  metrics: [],
  graph: {
    width: 400,
    height: 200,
    nodes: [
      { id: 'Lemma 1', label: 'Lemma 1', type: 'LEMMA', x: 20, y: 20, width: 176, height: 38, shared: false, inDegree: 1, outDegree: 0, supportsMainTheorem: true, statement: '辅助引理' },
      { id: 'Theorem 1', label: 'Theorem 1', type: 'THEOREM', x: 20, y: 90, width: 176, height: 38, shared: false, inDegree: 0, outDegree: 1, supportsMainTheorem: true, statement: '主定理陈述' },
    ],
    edges: [{ from: 'Theorem 1', to: 'Lemma 1', uncertain: false, external: false }],
  },
}

const SKILLS_BODY = {
  skills: [
    { name: 'math-glossary', description: '构建与查询双语术语库', files: 12 },
    { name: 'math-paper-reading', description: '论文结构化提取', files: 9 },
  ],
}

function mockFetch(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const table: Record<string, unknown> = {
    '/api/verymath/env': ENV_BODY,
    '/api/verymath/glossaries': { glossaries: [{ path: 'glossary/glossary.json', terms: 3, updatedAt: '2026-01-01' }] },
    '/api/verymath/glossary': GLOSSARY_BODY,
    '/api/verymath/structures': { structures: [{ path: 'demo_structure.json', title: 'Demo Paper', entities: 2 }] },
    '/api/verymath/paper': PAPER_BODY,
    '/api/verymath/skills': SKILLS_BODY,
    ...overrides,
  }
  const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
    const url = String(input)
    const base = url.split('?')[0] ?? url
    // A POST write echoes the patch it applied, which is enough for the panel.
    if (init !== undefined) return new Response(JSON.stringify({ added: [], updated: ['manifold'], stats: GLOSSARY_BODY.stats }), { status: 200 })
    const body = table[base]
    if (body === undefined) return new Response(JSON.stringify({ error: `no mock for ${base}` }), { status: 404 })
    return new Response(JSON.stringify(body), { status: 200 })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  mockFetch()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('panel renders', () => {
  it('shows the environment tab with real probe rows first', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))

    expect(screen.getByText('VeryMath 数学科研')).toBeTruthy()
    for (const tab of ['环境', '术语库', '论文图', '技能']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    }
    await waitFor(() => expect(screen.getByText('5/7')).toBeTruthy())
    expect(screen.getByText(/\/tmp\/demo-workspace/)).toBeTruthy()
    expect(screen.getByText('Python 3.14.7')).toBeTruthy()
    // A missing tool must carry an actionable, copyable command.
    expect(screen.getByText('conda create -n sage sage=10.9')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '复制' }).length).toBeGreaterThan(0)
  })

  it('switches to the glossary tab and shows stats, gaps and terms', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))
    fireEvent.click(screen.getByRole('button', { name: '术语库' }))

    await waitFor(() => expect(screen.getByText('glossary/glossary.json（3 条）')).toBeTruthy())
    // Stats strip.
    expect(screen.getByText('别名行')).toBeTruthy()
    expect(screen.getByText('缺例句')).toBeTruthy()
    // The gap list is a to-do, reachable by one click.
    const gapButton = await screen.findByRole('button', { name: /看缺口清单/ })
    fireEvent.click(gapButton)
    // '缺例句' labels both the stat and the gap block, so count rather than get.
    expect((await screen.findAllByText('缺例句')).length).toBeGreaterThan(1)
    expect(screen.getByText('cohomology')).toBeTruthy()

    // Search drives the query route; the term cards show examples.
    const search = screen.getByPlaceholderText(/查术语/)
    fireEvent.change(search, { target: { value: 'manifold' } })
    await waitFor(() => expect(screen.getByText('a smooth manifold — 光滑流形')).toBeTruthy())
    expect(screen.getByText('多样体')).toBeTruthy()
  })

  it('opens the editor for a term and for a new one', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))
    fireEvent.click(screen.getByRole('button', { name: '术语库' }))
    const search = await screen.findByPlaceholderText(/查术语/)
    fireEvent.change(search, { target: { value: 'manifold' } })
    await waitFor(() => expect(screen.getByText('流形')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    // Locate the form inputs by placeholder: the search box has its own, so these
    // can only be the editor's en/cn fields.
    const enField = (await screen.findByPlaceholderText('manifold')) as HTMLInputElement
    const cnField = screen.getByPlaceholderText('流形') as HTMLInputElement
    expect(enField.value).toBe('manifold')
    expect(cnField.value).toBe('流形')
    expect(screen.getByText(/带 term_id 提交/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '新增术语' }))
    expect(await screen.findByText(/不带 term_id = 新增/)).toBeTruthy()
    expect((screen.getByPlaceholderText('manifold') as HTMLInputElement).value).toBe('')
  })

  it('posts an edit to the write route', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))
    fireEvent.click(screen.getByRole('button', { name: '术语库' }))
    const search = await screen.findByPlaceholderText(/查术语/)
    fireEvent.change(search, { target: { value: 'manifold' } })
    await waitFor(() => expect(screen.getByText('流形')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    const cnField = (await screen.findByPlaceholderText('流形')) as HTMLInputElement
    fireEvent.change(cnField, { target: { value: '流形（几何）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      const write = calls.find((call) => String(call[0]) === '/api/verymath/glossary/upsert')
      expect(write, 'the panel must POST to the upsert route').toBeDefined()
      const payload = JSON.parse(String((write![1] as { body: string }).body))
      expect(payload).toMatchObject({ path: 'glossary/glossary.json' })
      expect(payload.terms[0]).toMatchObject({ term_id: 'manifold', cn: '流形（几何）' })
    })
  })

  it('renders the dependency graph and shows a node on click', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))
    fireEvent.click(screen.getByRole('button', { name: '论文图' }))

    await waitFor(() => expect(screen.getByText('复现顺序（自底向上）')).toBeTruthy())
    const svg = document.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(screen.getAllByText('Lemma 1').length).toBeGreaterThan(0)

    // Clicking a node opens its detail card with statement and degree.
    fireEvent.click(screen.getAllByText('Theorem 1')[0])
    await waitFor(() => expect(screen.getByText('主定理陈述')).toBeTruthy())
    expect(screen.getByText(/被引用 0 · 依赖 1/)).toBeTruthy()
  })

  it('lists bundled skills', async () => {
    const Panel = loadPanel()
    render(React.createElement(Panel))
    fireEvent.click(screen.getByRole('button', { name: '技能' }))

    await waitFor(() => expect(screen.getByText('math-glossary')).toBeTruthy())
    expect(screen.getByText('构建与查询双语术语库')).toBeTruthy()
    expect(screen.getByText('12 个文件')).toBeTruthy()
  })

  it('surfaces a route failure instead of a blank screen', async () => {
    mockFetch({})
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'boom from the host' }), { status: 500 })) as unknown as typeof fetch
    const Panel = loadPanel()
    render(React.createElement(Panel))

    await waitFor(() => expect(screen.getByText('读不到数据')).toBeTruthy())
    expect(screen.getByText('boom from the host')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
