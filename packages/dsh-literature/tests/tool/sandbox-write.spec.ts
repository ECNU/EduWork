/**
 * Regression: the tool's fs writes must be fenced by the SESSION sandbox
 * policy (workspace root = session cwd), not the deployment default root,
 * so a session whose cwd differs from the deployment fs-sandbox root still
 * persists files under its own workspace.
 */
// fs-sandbox root under workspace-write. Before the fix, the tool's write
// (no session policy) was fenced against the deployment root and denied.
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LiteratureSearchResult, FulltextResult } from '@eduwork/dsh-literature/core'
import * as tool from '@eduwork/dsh-literature/tool'

const signal = new AbortController().signal

describe('literature_fulltext sandbox write under a divergent session cwd', () => {
  it('persists files under the session workspace, not the deployment root', async () => {
    const deployRoot = await mkdtemp(join(tmpdir(), 'dsh-lit-deploy-'))
    const sessionWorkspace = await mkdtemp(join(tmpdir(), 'dsh-lit-session-'))
    const session = Session.create(SessionId('lit-sb'), undefined, {
      version: SESSION_FORMAT_VERSION,
      isSeeded: false,
      id: SessionId('lit-sb'),
      createdAt: Date.now(),
      cwd: sessionWorkspace,
    })
    const agent = { id: SessionId('lit-sb'), session } as unknown as Agent

    const ctx = new Context()
    ctx.provide('literature', {
      search: async (): Promise<LiteratureSearchResult> => ({ records: [], total: 0, truncated: false }),
      bibtex: async () => ({ bibtex: '', source: 'arxiv', published: false }),
      fulltext: async (): Promise<FulltextResult> => ({
        id: 'arxiv:2510.10008',
        kind: 'fulltext',
        source: 'arxiv-source',
        files: [{ path: 'main.tex', kind: 'tex', content: '% hello' }],
        summary: 's',
      }),
    })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' })
    await ctx.plugin(SandboxedFileSystem, { cwd: deployRoot })
    await ctx.plugin(tool, {})

    const result = await ctx.tools.execute({
      signal,
      callId: 'lit-sb-1',
      name: 'literature_fulltext',
      arguments: { query: '2510.10008', run_in_background: false },
      agent,
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    const written = join(sessionWorkspace, 'literature', 'arxiv_2510.10008', 'main.tex')
    expect(await readFile(written, 'utf8')).toBe('% hello')
    await rm(deployRoot, { recursive: true, force: true })
    await rm(sessionWorkspace, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })
})
