// Boots a cordis.yml through the real Loader: the tool registers via
// `ctx.tools` and the source registers via `ctx.literature`, proving the
// literature seam and its model-facing tools assemble in a REAL composition
// (packages/AGENTS.md: product-visible plugins require a non-unit
// REAL-composition test).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LiteratureRuntime } from '@eduwork/dsh-literature/core'
import * as tool from '@eduwork/dsh-literature/tool'

/** A stub source registering one dblp hit, booted through the Loader like a real provider. */
const stubSource = {
  name: 'stub-source',
  inject: ['literature'],
  apply(ctx: Context) {
    ctx.literature.registerSource({
      id: 'dblp',
      available: () => true,
      search: async () => [{ source: 'dblp', title: 'Paper.', rawTitle: 'Paper.', authors: ['A. Author'], year: 2026, preprint: false, dblpKey: 'conf/a/X' }],
      lookup: async () => null,
      bibtex: async () => ({ bibtex: '@inproceedings{x, title={Paper}}', source: 'dblp-formal', published: true }),
    })
  },
}

/** A stub `fs` the tool's inject waits on, booted through the Loader. */
const stubFs = {
  name: 'stub-fs',
  apply(ctx: Context) {
    ctx.provide('fs', {
      resolve: async () => ({ displayPath: '/ws/paper.md' }),
      writeText: async () => ({ operation: 'create' }),
    })
  },
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('tool-literature real Loader composition', () => {
  it('registers the three tools and executes literature_search through the seam', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-lit-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@eduwork/dsh-literature/core'",
      "- name: '@test/stub-source'",
      "- name: '@test/stub-fs'",
      "- name: '@eduwork/dsh-literature/tool'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@eduwork/dsh-literature/core', LiteratureRuntime],
      ['@test/stub-source', stubSource],
      ['@test/stub-fs', stubFs],
      ['@eduwork/dsh-literature/tool', tool],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const names = context.tools.schemas().map(schema => schema.name).filter(n => n.startsWith('literature_')).sort()
    expect(names).toEqual(['literature_bibtex', 'literature_fulltext', 'literature_search'])

    // The assembled seam accepted the source registration (the stub's `apply`
    // ran through the real Loader and the service store reflects it).
    const literature = context.get('literature') as LiteratureRuntime
    expect((literature as unknown as { sources: Map<string, unknown> }).sources.size).toBe(1)
  })
})
