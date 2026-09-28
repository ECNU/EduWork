/**
 * `@eduwork/dsh-literature/tool`: model-facing literature tools over
 * `ctx.literature`. Owns the tool names, schemas, validation, presentation,
 * and the publisher-PDF-link subagent fallback; the literature seam owns
 * retrieval, merging, and extraction.
 * @module @eduwork/dsh-literature/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-fs'
import {
  LiteratureError,
  compact,
  isHttpUrl,
  type FulltextResult,
  type LiteratureRecord,
} from '@eduwork/dsh-literature/core'

export const name = 'tool-literature'
export const inject = ['tools', 'literature', 'fs']

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    /** One full-text acquisition (arXiv or publisher-PDF path) run as a background job. */
    'literature-fulltext': 'literature-fulltext'
  }
}

/** Config: how the full-text fallback resolves publisher PDF links. */
export interface Config {
  /**
   * The `ctx.subagents` provider name used to extract a publisher PDF link
   * from a landing page (default `spawn`). The provider must support
   * `outputSchema` and `toolFilter`.
   */
  readonly subagentProvider?: string
}

export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
})

/** A model-facing text content block (the only block kind this tool emits). */
type TextBlock = { readonly type: 'text'; readonly text: string }

/** Whether a value looks like a {@link LiteratureError} even from a duplicated package copy. */
function isLiteratureError(error: unknown): error is LiteratureError {
  return error instanceof LiteratureError || (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'LiteratureError' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/** One paper's canonical JSON projection. */
interface PaperJson {
  readonly id: string
  readonly title: string
  readonly authors: string[]
  readonly published: boolean
  readonly sources: string[]
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly arxivId?: string
  readonly url?: string
  readonly openAccessUrl?: string
  readonly abstract?: string
}

/** The `literature_search` canonical value. */
interface SearchJson {
  readonly total: number
  readonly truncated: boolean
  readonly papers: PaperJson[]
}

/** The `literature_bibtex` canonical value. */
interface BibtexJson {
  readonly bibtex: string
  readonly source: string
  readonly published: boolean
  readonly note?: string
}

/** The `literature_fulltext` canonical value. */
interface FulltextJson {
  readonly kind: 'fulltext'
  readonly source?: string
  readonly files: Array<{ readonly path: string; readonly kind: string }>
  readonly summary: string
}

/** The `literature_fulltext` background-job start value. */
interface BackgroundJson {
  readonly kind: 'background'
  readonly jobId: string
}

/** The `literature_fulltext` canonical output union. */
type FulltextToolJson = FulltextJson | BackgroundJson

/** Structured output of the PDF-link subagent: one absolute http(s) URL, or null. */
const PDF_LINK_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pdfUrl: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['pdfUrl'],
}

/** Project one merged record to its schema-visible JSON (omitting absent fields). */
function recordJson(record: LiteratureRecord): PaperJson {
  return compact({
    id: record.id,
    title: record.rawTitle ?? record.title,
    authors: [...record.authors],
    published: record.published,
    sources: [...record.sources],
    year: record.year,
    venue: record.venue,
    doi: record.doi,
    arxivId: record.arxivId,
    url: record.url,
    openAccessUrl: record.openAccessUrl,
    abstract: record.abstract,
  })
}

/** Render a search result as a readable, bounded paper list. */
function renderSearch(_args: unknown, value: unknown): TextBlock[] {
  const result = value as SearchJson
  if (result.papers.length === 0) return [{ type: 'text', text: 'No papers matched the query.' }]
  const lines = result.papers.map((paper) => {
    const year = paper.year !== undefined ? ` (${paper.year})` : ''
    const venue = paper.venue !== undefined ? ` — ${paper.venue}` : ''
    const ids = [
      paper.arxivId !== undefined ? `arXiv:${paper.arxivId}` : undefined,
      paper.doi !== undefined ? `doi:${paper.doi}` : undefined,
    ].filter((part): part is string => part !== undefined).join(', ')
    return `- ${paper.id} | ${paper.title}${year}${venue}${ids.length > 0 ? ` | ${ids}` : ''}${paper.published ? '' : ' [preprint]'}`
  })
  const note = result.truncated ? `\n(truncated to ${result.papers.length} of ${result.total})` : ''
  return [{ type: 'text', text: `${lines.join('\n')}${note}` }]
}

/** Render a BibTeX result as one fenced block. */
function renderBibtex(_args: unknown, value: unknown): TextBlock[] {
  const result = value as BibtexJson
  const note = result.note !== undefined ? `\n${result.note}` : ''
  return [{ type: 'text', text: `\`\`\`bibtex\n${result.bibtex}\n\`\`\`${note}` }]
}

/** The model-visible text of one persisted full-text result. */
function fulltextText(result: FulltextJson): string {
  const files = result.files.length > 0
    ? `\n\nFiles:\n${result.files.map(file => `- ${file.path}`).join('\n')}`
    : ''
  return `${result.summary}${files}`
}

/** Render a full-text result, or the background-job start it returned. */
function renderFulltext(_args: unknown, value: unknown): TextBlock[] {
  const result = value as FulltextToolJson
  if (result.kind === 'background') {
    return [{ type: 'text', text: `started background full-text job ${result.jobId}; collect with job_output` }]
  }
  return [{ type: 'text', text: fulltextText(result) }]
}

/**
 * Build the pinned extraction prompt for the PDF-link subagent: one bounded
 * minified landing-page HTML, a fixed instruction, and a structured `pdfUrl`
 * answer (`null` when the page exposes no PDF link).
 * @param page - the bounded minified landing-page HTML.
 * @param ref - optional paper identity lines for disambiguation.
 * @returns the child's user message text.
 */
function pdfLinkPrompt(page: string, ref: { readonly title?: string; readonly doi?: string }): string {
  const identity = [
    ref.title !== undefined ? `Paper title: ${ref.title}` : undefined,
    ref.doi !== undefined ? `Paper DOI: ${ref.doi}` : undefined,
  ].filter((line): line is string => line !== undefined).join('\n')
  return [
    'Extract the direct full-text PDF link from a publisher landing page for an academic paper.',
    identity,
    '',
    'The page content below is the minified HTML of the landing page. Find the URL of the paper\'s full-text PDF — commonly an anchor (<a href="...">) labeled "PDF", "Full text", "Download PDF", or "Read full text", or a URL assigned in an inline script — and return its absolute http(s) URL as `pdfUrl`. Return `pdfUrl: null` when the page exposes no PDF link.',
    '',
    'Page content:',
    page,
  ].join('\n')
}

/** A human line for a non-`completed` subagent stop reason. */
function stopReasonLine(reason: SubagentResult['stopReason']): string {
  switch (reason) {
    case 'completed':
      return 'completed'
    case 'aborted':
      return 'was cancelled'
    case 'error':
      return 'failed'
    case 'max-tokens':
      return 'hit its token limit before finishing'
    case 'refusal':
      return 'declined the task'
    // Merge-extensible union: an unknown terminal reason is a failure.
    default:
      return `ended abnormally (${String(reason)})`
  }
}

/**
 * Collect a PDF-link subagent's structured result and always dispose the run.
 * A non-`completed` stop reason or an infrastructure rejection maps to
 * `LITERATURE_FULLTEXT_UNAVAILABLE`; a missing or empty `pdfUrl` means the
 * page exposed no PDF link (`null`).
 * @param run - the live subagent run.
 * @returns the absolute PDF URL, or `null` when the page has none.
 */
async function collectPdfUrl(run: SubagentRun): Promise<string | null> {
  const [settlement] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (settlement.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [settlement.reason, disposal.reason],
        `PDF link extraction failed: ${String(settlement.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw new LiteratureError(`PDF link extraction failed: ${String(settlement.reason)}`, 'LITERATURE_FULLTEXT_UNAVAILABLE', {
      cause: settlement.reason,
    })
  }
  if (disposal.status === 'rejected') throw disposal.reason
  const result = settlement.value
  if (result.stopReason !== 'completed') {
    throw new LiteratureError(`PDF link extraction ${stopReasonLine(result.stopReason)}`, 'LITERATURE_FULLTEXT_UNAVAILABLE')
  }
  const url = (result.structured as { readonly pdfUrl?: unknown } | undefined)?.pdfUrl
  return typeof url === 'string' && url.trim().length > 0 ? url.trim() : null
}

/** Register the literature search, BibTeX, and full-text tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const subagentProvider = config.subagentProvider ?? 'spawn'

  /**
   * Resolve the sandbox policy for the calling session, so the fs writes land
   * under the session's workspace-write root instead of the deployment
   * default (which can differ in the Web surface).
   * @param parent - the calling agent whose session owns the policy.
   * @returns the session policy, or undefined without a policy service.
   */
  function sessionSandboxPolicy(parent: Agent | undefined) {
    return ctx.get('sandboxPolicy')?.resolve(parent !== undefined ? { session: parent.session } : {})
  }

  /** Persist one full-text result's files through `ctx.fs` and project it. */
  async function persistFulltext(
    result: FulltextResult,
    signal: AbortSignal,
    cwd: string | undefined,
    sandboxPolicy: ReturnType<typeof sessionSandboxPolicy>,
  ): Promise<FulltextJson> {
    const dir = result.id.replace(/[^a-zA-Z0-9._-]/gu, '_')
    const written: Array<{ path: string; kind: string }> = []
    for (const file of result.files) {
      const target = await ctx.fs.resolve(`literature/${dir}/${file.path}`, {
        ...(cwd !== undefined ? { cwd } : {}),
        signal,
      })
      await ctx.fs.writeText(target, file.content, undefined, signal, sandboxPolicy)
      written.push({ path: target.displayPath, kind: file.kind })
    }
    return compact({ kind: 'fulltext', source: result.source, files: written, summary: result.summary }) as FulltextJson
  }

  /**
   * Resolve the publisher PDF link for a reference whose direct full-text
   * acquisition failed: fetch the bounded landing page, delegate link
   * extraction to a zero-tool subagent, and return the PDF URL, or `null`
   * when the page exposes no PDF link. Requires the `subagents` service and
   * the configured provider at call time.
   * @param input - the free-form reference or landing-page URL.
   * @param parent - the calling agent, which owns the subagent.
   * @param signal - cancellation.
   * @returns the absolute PDF URL, or `null` when the page has none.
   */
  async function resolvePublisherPdfUrl(input: string, parent: Agent, signal: AbortSignal): Promise<string | null> {
    const subagents = ctx.get('subagents')
    if (subagents === undefined) {
      throw new LiteratureError('publisher PDF link resolution requires the subagents service', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    }
    if (subagents.getProvider(subagentProvider) === undefined) {
      throw new LiteratureError(
        `publisher PDF link resolution requires the subagent provider "${subagentProvider}" (load a provider such as @deepseek-ai/dsh-subagent-spawn-in-process)`,
        'LITERATURE_FULLTEXT_UNAVAILABLE',
      )
    }
    let page: string
    let title: string | undefined
    let doi: string | undefined
    if (isHttpUrl(input)) {
      page = await ctx.literature.landingPage(input, signal)
    } else {
      const record = await ctx.literature.resolveRecord(input, signal)
      if (record.doi === undefined) {
        throw new LiteratureError(`no full text available for ${JSON.stringify(input)}`, 'LITERATURE_FULLTEXT_UNAVAILABLE')
      }
      title = record.title
      doi = record.doi
      page = await ctx.literature.landingPage(record.doi, signal)
    }
    const run = await subagents.start(subagentProvider, {
      label: 'literature PDF link',
      prompt: [{ type: 'text', text: pdfLinkPrompt(page, {
        ...(title !== undefined ? { title } : {}),
        ...(doi !== undefined ? { doi } : {}),
      }) }] as ContentBlock[],
      parent,
      outputSchema: PDF_LINK_SCHEMA,
      toolFilter: { allow: [] },
      signal,
    })
    return collectPdfUrl(run)
  }

  /**
   * Acquire one paper's full text — the arXiv artifact path, then the
   * publisher-PDF-link subagent fallback — and persist the extracted files.
   * @param input - the free-form reference or explicit URL.
   * @param parent - the calling agent, which owns the fallback subagent.
   * @param signal - cancellation.
   * @returns the persisted full-text projection.
   */
  async function acquireFulltext(input: string, parent: Agent | undefined, signal: AbortSignal): Promise<FulltextJson> {
    let result: FulltextResult
    try {
      result = await ctx.literature.fulltext(input, signal)
    } catch (error) {
      if (!isLiteratureError(error) || error.code !== 'LITERATURE_FULLTEXT_UNAVAILABLE') throw error
      if (parent === undefined) {
        throw new LiteratureError('publisher PDF link resolution requires a calling agent', 'LITERATURE_FULLTEXT_UNAVAILABLE')
      }
      const pdfUrl = await resolvePublisherPdfUrl(input, parent, signal)
      if (pdfUrl === null) throw error
      result = await ctx.literature.fulltext(pdfUrl, signal)
    }
    return persistFulltext(result, signal, parent?.session.header.cwd, sessionSandboxPolicy(parent))
  }

  ctx.tools.register(defineTool({
    name: 'literature_search',
    description: 'Search academic literature across dblp and arXiv; returns merged records with ids for follow-up bibtex/fulltext lookups.',
    parameters: {
      query: { type: 'string', required: true, description: 'Title words, author, or keywords' },
      maxResults: { type: 'number', description: 'Maximum papers to return per source (default 10)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          papers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                authors: { type: 'array', items: { type: 'string' } },
                year: { type: 'number' },
                venue: { type: 'string' },
                doi: { type: 'string' },
                arxivId: { type: 'string' },
                published: { type: 'boolean', required: true },
                sources: { type: 'array', items: { type: 'string' }, required: true },
                url: { type: 'string' },
                openAccessUrl: { type: 'string' },
                abstract: { type: 'string' },
              },
            },
          },
        },
      },
      render: renderSearch,
    },
    async execute(args) {
      const { query, maxResults } = args
      const result = await ctx.literature.search({ query, ...(maxResults !== undefined ? { maxResults } : {}) })
      return {
        total: result.total,
        truncated: result.truncated,
        papers: result.records.map(recordJson),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'literature_bibtex',
    description: 'Fetch a BibTeX entry for a paper (title, arXiv id, dblp key, or DOI). Prefers the formal dblp record, then the arXiv entry for a still-unpublished preprint, then the dblp CoRR mirror.',
    parameters: {
      query: { type: 'string', required: true, description: 'Paper title, arXiv id, dblp key, or DOI' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bibtex: { type: 'string', required: true },
          source: { type: 'string', required: true },
          published: { type: 'boolean', required: true },
          note: { type: 'string' },
        },
      },
      render: renderBibtex,
    },
    async execute(args) {
      const result = await ctx.literature.bibtex(args.query)
      return compact({
        bibtex: result.bibtex,
        source: result.source,
        published: result.published,
        note: result.note,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'literature_fulltext',
    description: 'Acquire the full text of a paper (title, arXiv id, dblp key, DOI, or an explicit PDF/landing-page URL) and persist the extracted sources into the workspace. Tries the arXiv source tarball, then arXiv HTML, then arXiv PDF, then resolves the publisher PDF link via a subagent. This tool runs in the background by default and immediately returns a job id, so downloads (which can take tens of seconds on publisher sites) never block other work; collect the result with job_output. Set run_in_background: false only when your next action depends on the extracted text.',
    parameters: {
      query: { type: 'string', required: true, description: 'Paper title, arXiv id, dblp key, DOI, or an explicit PDF/landing-page URL' },
      run_in_background: {
        type: 'boolean',
        description: 'Whether to run the acquisition as a background job and return its id immediately. Defaults to true; set false to wait for the extracted text.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'fulltext' },
              source: { type: 'string' },
              files: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                  },
                },
              },
              summary: { type: 'string', required: true },
            },
          },
        ],
      },
      render: renderFulltext,
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (args.run_in_background !== false) {
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new LiteratureError(
            'background full text requires the jobs service (load @deepseek-ai/dsh-jobs-local and @deepseek-ai/dsh-tool-jobs)',
            'LITERATURE_FULLTEXT_UNAVAILABLE',
          )
        }
        if (parent === undefined) {
          throw new LiteratureError('background full text requires a calling agent', 'LITERATURE_FULLTEXT_UNAVAILABLE')
        }
        const id = jobs.start({
          kind: 'literature-fulltext',
          label: args.query,
          owner: parent.id,
          run: () => {
            const controller = new AbortController()
            return {
              cancel: (reason?: string) => {
                controller.abort(reason ?? 'literature fulltext job killed')
              },
              done: (async (): Promise<JobOutcome> => {
                try {
                  const json = await acquireFulltext(args.query, parent, controller.signal)
                  return { status: 'completed', result: fulltextText(json) }
                } catch (error) {
                  return { status: controller.signal.aborted ? 'killed' : 'failed', detail: String(error) }
                }
              })(),
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }
      return acquireFulltext(args.query, parent, exec.signal)
    },
  }))
}
