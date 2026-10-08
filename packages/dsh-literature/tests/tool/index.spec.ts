import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobSpec } from '@deepseek-ai/dsh-jobs'
import { LiteratureError, type BibtexResult, type FulltextResult, type LiteratureRecord, type LiteratureSearchResult } from '@eduwork/dsh-literature/core'
import * as tool from '../../src/tool/index.ts'

const signal = new AbortController().signal

function record(over: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    id: 'arxiv:2510.10008',
    title: 'RIPRAG: Hack a System.',
    authors: ['A. Author'],
    arxivId: '2510.10008',
    published: false,
    sources: ['arxiv'],
    ...over,
  }
}

function searchResult(records: LiteratureRecord[], over: Partial<LiteratureSearchResult> = {}): LiteratureSearchResult {
  return { records, total: records.length, truncated: false, ...over }
}

interface Fs {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ displayPath: string }>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<{ operation: 'create' }>
}

/** A stub `ctx.literature` the tool executes against. */
interface LiteratureStub {
  search: (request: { query: string; maxResults?: number }) => Promise<LiteratureSearchResult>
  bibtex: (input: string) => Promise<{ bibtex: string; source: string; published: boolean; note?: string }>
  fulltext: (input: string, signal: AbortSignal) => Promise<FulltextResult>
  landingPage?: (input: string, signal: AbortSignal) => Promise<string>
  resolveRecord?: (input: string, signal: AbortSignal) => Promise<LiteratureRecord>
}

/** A stub `ctx.subagents` whose `start` resolves one settled run. */
interface SubagentsStub {
  getProvider(name: string): { name: string } | undefined
  start(name: string, request: unknown): Promise<{
    id: string
    result: Promise<{ stopReason: 'completed' | 'error'; output: unknown[]; structured?: unknown }>
    dispose: () => Promise<void>
  }>
}

function settledRun(structured: unknown, stopReason: 'completed' | 'error' = 'completed'): NonNullable<Awaited<ReturnType<SubagentsStub['start']>>> {
  return {
    id: 'sub-lit-1',
    result: Promise.resolve({ stopReason, output: [], structured }),
    dispose: async () => {},
  }
}

async function setup(
  literature: LiteratureStub,
  fs: Fs,
  subagentsStub?: SubagentsStub,
  jobsStub?: { start: (spec: JobSpec) => unknown },
  sandboxPolicyStub?: { resolve: (request: unknown) => unknown },
): Promise<Context> {
  const ctx = new Context()
  ctx.provide('literature', literature)
  ctx.provide('fs', fs)
  if (subagentsStub !== undefined) ctx.provide('subagents', subagentsStub)
  if (jobsStub !== undefined) ctx.provide('jobs', jobsStub)
  if (sandboxPolicyStub !== undefined) ctx.provide('sandboxPolicy', sandboxPolicyStub)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return ctx
}

function agent(cwd?: string): Agent {
  const session = cwd === undefined
    ? Session.create(SessionId('tool-lit'))
    : Session.create(SessionId('tool-lit'), undefined, { version: SESSION_FORMAT_VERSION, id: SessionId('tool-lit'), createdAt: Date.now(), isSeeded: false, cwd })
  return { id: SessionId('tool-lit'), session } as unknown as Agent
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

let counter = 0
async function execute(ctx: Context, name: string, args: unknown, execAgent: Agent = agent()) {
  return ctx.tools.execute({ signal, callId: `lit-${++counter}`, name, arguments: args, agent: execAgent })
}

describe('dsh-tool-literature', () => {
  it('registers the three literature tools', async () => {
    const ctx = await setup(
      { search: async () => searchResult([]), bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }), fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }) },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const names = ctx.tools.schemas().map(schema => schema.name).filter(n => n.startsWith('literature_')).sort()
    expect(names).toEqual(['literature_bibtex', 'literature_fulltext', 'literature_search'])
  })

  it('renders a search result with a preprint flag and truncation', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([record({ published: true, venue: 'ACL', year: 2026 })], { total: 5, truncated: true }),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_search', { query: 'riprag' })
    expect(text(result)).toContain('arXiv:2510.10008')
    expect(text(result)).toContain('(2026) — ACL')
    expect(text(result)).toContain('truncated to 1 of 5')
  })

  it('renders the source-native raw title when the record carries one', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([record({ title: 'attention is all you need', rawTitle: 'Attention Is All You Need', published: true })]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_search', { query: 'attention' })
    expect(text(result)).toContain('Attention Is All You Need')
    expect(text(result)).not.toContain('attention is all you need')
  })

  it('renders an empty search result', async () => {
    const ctx = await setup(
      { search: async () => searchResult([]), bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }), fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }) },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_search', { query: 'nothing' })
    expect(text(result)).toBe('No papers matched the query.')
  })

  it('renders bibtex with and without a note', async () => {
    const literature = {
      search: async () => searchResult([]),
      bibtex: vi.fn(async (): Promise<BibtexResult> => ({ bibtex: '@misc{key}', source: 'arxiv', published: false })),
      fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
    }
    const ctx = await setup(literature, { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) })
    const result = await execute(ctx, 'literature_bibtex', { query: '2510.10008' })
    expect(text(result)).toContain('@misc{key}')
    expect(text(result)).not.toContain('arXiv BibTeX')

    literature.bibtex.mockResolvedValue({ bibtex: '@misc{key}', source: 'arxiv', published: false, note: 'a caveat' })
    const withNote = await execute(ctx, 'literature_bibtex', { query: '2510.10008' })
    expect(text(withNote)).toContain('a caveat')
  })

  it('writes full-text files through ctx.fs and returns their display paths', async () => {
    const writeText = vi.fn(async () => ({ operation: 'create' as const }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({
          id: 'arxiv:2510.10008',
          kind: 'fulltext',
          source: 'arxiv-source',
          files: [{ path: 'src/main.tex', kind: 'tex', content: '% tex' }],
          summary: 'Hello world',
        }),
      },
      { resolve: async path => ({ displayPath: `/ws/literature/x/${path}` }), writeText },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '2510.10008', run_in_background: false })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(text(result)).toContain('Hello world')
    expect(text(result)).toContain('/ws/literature/x/literature/arxiv_2510.10008/src/main.tex')
  })

  it('resolves a DOI-only record through a subagent and persists the full text', async () => {
    const writeText = vi.fn(async () => ({ operation: 'create' as const }))
    const fulltext = vi.fn(async (input: string): Promise<FulltextResult> => {
      if (input === 'https://example.com/paper.pdf') {
        return { id: input, kind: 'fulltext', source: 'publisher-pdf', files: [{ path: 'paper.txt', kind: 'text', content: 'body' }], summary: 'Extracted body' }
      }
      throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    })
    const start = vi.fn(async (_name: string, _request: unknown) => settledRun({ pdfUrl: 'https://example.com/paper.pdf' }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext,
        landingPage: async () => 'Page with a <a href="https://example.com/paper.pdf">PDF</a> link',
        resolveRecord: async () => record({ id: 'doi:10.1/x', title: 'Paper.', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async path => ({ displayPath: `/ws/${path}` }), writeText },
      { getProvider: () => ({ name: 'spawn' }), start },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(fulltext).toHaveBeenNthCalledWith(1, '10.1/x', expect.any(AbortSignal))
    expect(fulltext).toHaveBeenNthCalledWith(2, 'https://example.com/paper.pdf', expect.any(AbortSignal))
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'literature PDF link',
      toolFilter: { allow: [] },
    }))
    const request = start.mock.calls[0]![1] as { outputSchema?: { required?: string[] } }
    expect(request.outputSchema).toMatchObject({ required: ['pdfUrl'] })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(text(result)).toContain('Extracted body')
  })

  it('resolves a DOI-only record when the unavailable error comes from a duplicated core copy', async () => {
    const writeText = vi.fn(async () => ({ operation: 'create' as const }))
    const fulltext = vi.fn(async (input: string): Promise<FulltextResult> => {
      if (input === 'https://example.com/paper.pdf') {
        return { id: input, kind: 'fulltext', source: 'publisher-pdf', files: [{ path: 'paper.txt', kind: 'text', content: 'body' }], summary: 'Extracted body' }
      }
      throw Object.assign(new Error('no full text'), { name: 'LiteratureError', code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
    })
    const start = vi.fn(async () => settledRun({ pdfUrl: 'https://example.com/paper.pdf' }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext,
        landingPage: async () => 'Page with a <a href="https://example.com/paper.pdf">PDF</a> link',
        resolveRecord: async () => record({ id: 'doi:10.1/x', title: 'Paper.', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async path => ({ displayPath: `/ws/${path}` }), writeText },
      { getProvider: () => ({ name: 'spawn' }), start },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(fulltext).toHaveBeenCalledTimes(2)
    expect(text(result)).toContain('Extracted body')
  })

  it('resolves a landing-page URL input through a subagent', async () => {
    const fulltext = vi.fn(async (input: string): Promise<FulltextResult> => {
      if (input === 'https://example.com/paper.pdf') {
        return { id: input, kind: 'fulltext', source: 'publisher-pdf', files: [], summary: 'Extracted body' }
      }
      throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    })
    const landingPage = vi.fn(async () => 'Page content with PDF link')
    const start = vi.fn(async () => settledRun({ pdfUrl: 'https://example.com/paper.pdf' }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext,
        landingPage,
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => ({ name: 'spawn' }), start },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: 'https://example.com/landing', run_in_background: false })
    expect(landingPage).toHaveBeenCalledWith('https://example.com/landing', expect.any(AbortSignal))
    expect(text(result)).toContain('Extracted body')
  })

  it('fails when the subagent finds no PDF link', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        landingPage: async () => 'Page with no PDF link',
        resolveRecord: async () => record({ id: 'doi:10.1/x', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => ({ name: 'spawn' }), start: async () => settledRun({ pdfUrl: null }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no full text')
  })

  it('fails when the subagent run fails', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        landingPage: async () => 'Page',
        resolveRecord: async () => record({ id: 'doi:10.1/x', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => ({ name: 'spawn' }), start: async () => settledRun({ pdfUrl: 'https://example.com/paper.pdf' }, 'error') },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('PDF link extraction failed')
  })

  it('fails when the subagents service is absent', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        landingPage: async () => 'Page',
        resolveRecord: async () => record({ id: 'doi:10.1/x', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires the subagents service')
  })

  it('fails when the configured subagent provider is absent', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        landingPage: async () => 'Page',
        resolveRecord: async () => record({ id: 'doi:10.1/x', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => undefined, start: async () => settledRun({ pdfUrl: null }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: false })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires the subagent provider "spawn"')
  })

  it('fails when the resolved record has no DOI', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        resolveRecord: async () => record({ id: 'arxiv:2510.10008' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => ({ name: 'spawn' }), start: async () => settledRun({ pdfUrl: null }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '2510.10008', run_in_background: false })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no full text available')
  })

  it('fails when no calling agent owns the fallback', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => { throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE') },
        landingPage: async () => 'Page',
        resolveRecord: async () => record({ id: 'doi:10.1/x', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      { getProvider: () => ({ name: 'spawn' }), start: async () => settledRun({ pdfUrl: null }) },
    )
    const result = await ctx.tools.execute({
      signal,
      callId: `lit-${++counter}`,
      name: 'literature_fulltext',
      arguments: { query: '10.1/x', run_in_background: false },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('starts a background job and settles it with the persisted full-text output', async () => {
    const writeText = vi.fn(async () => ({ operation: 'create' as const }))
    const fulltext = vi.fn(async (input: string): Promise<FulltextResult> => {
      if (input === 'https://example.com/paper.pdf') {
        return { id: input, kind: 'fulltext', source: 'publisher-pdf', files: [{ path: 'paper.txt', kind: 'text', content: 'body' }], summary: 'Extracted body' }
      }
      throw new LiteratureError('no full text', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    })
    let captured: JobSpec | undefined
    const start = vi.fn((spec: JobSpec) => {
      captured = spec
      return JobId('literature-fulltext-1')
    })
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext,
        landingPage: async () => 'Page with a <a href="https://example.com/paper.pdf">PDF</a> link',
        resolveRecord: async () => record({ id: 'doi:10.1/x', title: 'Paper.', doi: '10.1/x', published: true, sources: ['dblp'] }),
      },
      { resolve: async path => ({ displayPath: `/ws/${path}` }), writeText },
      { getProvider: () => ({ name: 'spawn' }), start: async () => settledRun({ pdfUrl: 'https://example.com/paper.pdf' }) },
      { start },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: true })
    expect(text(result)).toContain('started background full-text job literature-fulltext-1')
    expect(captured).toMatchObject({ kind: 'literature-fulltext', label: '10.1/x' })
    expect(captured!.owner).toBe('tool-lit')
    const hooks = captured!.run()
    const outcome = await hooks.done
    expect(outcome).toMatchObject({ status: 'completed' })
    expect(outcome.result).toContain('Extracted body')
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('fails a background call when the jobs service is absent', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: '10.1/x', run_in_background: true })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires the jobs service')
  })

  it('fails a background call without a calling agent', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
      undefined,
      { start: vi.fn(() => JobId('literature-fulltext-1')) },
    )
    const result = await ctx.tools.execute({
      signal,
      callId: `lit-${++counter}`,
      name: 'literature_fulltext',
      arguments: { query: '10.1/x', run_in_background: true },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('passes the session-resolved sandbox policy to the fs write', async () => {
    const writeText = vi.fn(async (_t: unknown, _c: string, _e?: unknown, _s?: AbortSignal, _p?: unknown) => ({ operation: 'create' as const }))
    const resolvePolicy = vi.fn((_request: unknown) => ({ mode: 'workspace-write', workspaceRoot: '/ws' }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({
          id: 'arxiv:2510.10008',
          kind: 'fulltext',
          source: 'arxiv-source',
          files: [{ path: 'main.tex', kind: 'tex', content: '% tex' }],
          summary: 's',
        }),
      },
      { resolve: async () => ({ displayPath: '/ws/literature/x/main.tex' }), writeText },
      undefined,
      undefined,
      { resolve: resolvePolicy },
    )
    await execute(ctx, 'literature_fulltext', { query: '2510.10008', run_in_background: false })
    expect(resolvePolicy).toHaveBeenCalledTimes(1)
    expect(resolvePolicy.mock.calls[0]?.[0]).toHaveProperty('session')
    const policy = writeText.mock.calls[0]?.[4]
    expect(policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: '/ws' })
  })

  it('renders a sparse search record without year, venue, or arXiv id, plus an empty id list', async () => {
    const bare: LiteratureRecord = { id: 'title:bare', title: 'Bare Paper', authors: [], published: false, sources: ['arxiv'], doi: '10.1/x' }
    const noIds: LiteratureRecord = { id: 'title:noids', title: 'No Ids', authors: [], published: true, sources: ['arxiv'] }
    const ctx = await setup(
      {
        search: async () => searchResult([bare, noIds], { truncated: false }),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_search', { query: 'x' })
    const out = text(result)
    expect(out).toContain('doi:10.1/x')
    expect(out).toContain('[preprint]')
    expect(out).not.toContain('arXiv:')
    expect(out).not.toContain('truncated')
  })

  it('renders a fulltext result with no files', async () => {
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: 'Just text' }),
      },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    const result = await execute(ctx, 'literature_fulltext', { query: 'x', run_in_background: false })
    expect(text(result)).toBe('Just text')
  })

  it('passes maxResults through to the literature search', async () => {
    const search = vi.fn(async () => searchResult([]))
    const ctx = await setup(
      { search, bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }), fulltext: async (): Promise<FulltextResult> => ({ id: 'x', kind: 'fulltext', files: [], summary: '' }) },
      { resolve: async () => ({ displayPath: '/ws/x' }), writeText: async () => ({ operation: 'create' }) },
    )
    await execute(ctx, 'literature_search', { query: 'x', maxResults: 3 })
    expect(search).toHaveBeenCalledWith({ query: 'x', maxResults: 3 })
  })

  it('resolves the full-text directory against the session cwd', async () => {
    const resolve = vi.fn(async (_path: string) => ({ displayPath: '/ws/main.tex' }))
    const ctx = await setup(
      {
        search: async () => searchResult([]),
        bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
        fulltext: async (): Promise<FulltextResult> => ({ id: 'arxiv:2510.10008', kind: 'fulltext', source: 'arxiv-source', files: [{ path: 'main.tex', kind: 'tex', content: '% tex' }], summary: 's' }),
      },
      { resolve, writeText: async () => ({ operation: 'create' }) },
    )
    await execute(ctx, 'literature_fulltext', { query: 'x', run_in_background: false }, agent('/ws'))
    expect(resolve).toHaveBeenCalledWith('literature/arxiv_2510.10008/main.tex', expect.objectContaining({ cwd: '/ws' }))
  })
})
