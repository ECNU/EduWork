import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {Remote, TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol'
import {defineDomain, domainTable} from '@deepseek-ai/dsh-storage-domain'
import * as codex from '@deepseek-ai/dsh-subagent-codex'
import * as acp from '@deepseek-ai/dsh-subagent-acp'
import * as tool from '@deepseek-ai/dsh-tool-subagent'
import {entrySchema} from './remote.js'
import {discover, executable, probe} from './discovery.js'

const spec = defineDomain({name: 'eduwork_external_agents', version: 1, tables: {agents: domainTable(entrySchema)}})
const initializers = []
export class Connections extends TypertRemoteService {
  static inject = ['storageDomain', 'subagents', 'subprocess', 'tools', 'systemPrompt', 'sessionProjections']
  constructor(ctx) {
    super(ctx, 'eduworkAgentConnections')
    // Registrations must outlive a remote call and belong to this plugin.
    this.ownerContext = ctx
    for (const initialize of initializers) initialize.call(this)
    this.active = new Map(); this.checks = new Map()
    this.queue = Promise.resolve()
    this.ready = this.open()
    // Keep a failed optional connection from becoming an unhandled Host rejection.
    void this.ready.catch(() => ctx.logger.warn('External agent registration unavailable'))
    ctx.effect(() => async () => {
      try { await this.ready; await this.queue } finally { await this.domain?.close() }
    })
  }
  async open() {
    this.domain = await this.ctx.storageDomain.open(spec)
    this.table = this.domain.table('agents')
    for (const [, entry] of this.table.entries()) if (entry.enabled) {
      try { await this.activate(entry) }
      catch { this.checks.set(entry.id, {ok: false, message: 'activation_failed'}) }
    }
  }
  async activate(entry) {
    const provider = entry.kind === 'codex' ? 'codex' : `eduwork_${entry.id}`
    const fibers = []
    try {
      fibers.push(this.ownerContext.plugin(entry.kind === 'codex' ? codex : acp, entry.kind === 'codex'
        ? {providerName: provider, permissionMode: 'never'}
        : {providerName: provider, command: entry.command, args: entry.args, permission: 'reject'}))
      await fibers[0]
      fibers.push(this.ownerContext.plugin(tool, {provider, toolName: `subagent_${provider}`, maxDepth: 'provider-managed'}))
      await fibers[1]
      this.active.set(entry.id, fibers)
    } catch (error) { for (const fiber of fibers.toReversed()) await fiber.dispose(); throw error }
  }
  async rows() {
    const found = await discover()
    const entries = new Map(found.map(row => [row.id, {...row, enabled: false}]))
    for (const [id, row] of this.table.entries()) entries.set(id, {...row, installed: row.kind === 'codex' || !!row.command && await executable(row.command)})
    return [...entries.values()].map(row => ({...row, checked: this.checks.get(row.id)?.ok ?? false, message: this.checks.get(row.id)?.message ?? 'unchecked'}))
  }
  async manage(request) {
    // Serialize probe/save/toggle so stale probes cannot enable a replaced command.
    const operation = this.queue.then(async () => {
      await this.ready
      const rows = await this.rows()
      if (request.op === 'list') return {rows}
      if (request.op === 'add') {
        if (!await executable(request.command)) throw new Error('invalid_path')
        if (rows.length >= 18) throw new Error('agent_limit')
        const entry = {id: 'acp_' + randomUUID().replaceAll('-', '').slice(0, 12), name: request.name, kind: 'acp', command: request.command, args: request.args, enabled: false}
        await this.table.put(entry.id, entry)
      } else {
        const row = rows.find(row => row.id === request.id)
        if (!row) throw new Error('Unknown agent')
        const entry = entrySchema.parse({id: row.id, name: row.name, kind: row.kind, command: row.command, args: row.args, enabled: row.enabled})
        if (request.op === 'remove') {
          if (!entry.id.startsWith('acp_') || entry.enabled) throw new Error('disable_first')
          await this.table.delete(entry.id); this.checks.delete(entry.id)
        } else if (request.op === 'check') {
          let result
          if (row.kind === 'codex') {
            const require = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-subagent-codex'))
            const manifest = require.resolve('@openai/codex/package.json')
            const bin = resolve(dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).bin.codex)
            result = await probe(this.ctx.subprocess, process.execPath, [bin, 'login', 'status'])
          } else result = row.command ? await probe(this.ctx.subprocess, row.command, row.args, {acp: true}) : {ok: false, message: 'missing_cli'}
          this.checks.delete(row.id)
          if (result.ok) await this.table.put(row.id, entry)
          this.checks.set(row.id, result)
        } else if (request.op === 'enable' && request.enabled !== row.enabled) {
          if (request.enabled) {
            if (!this.checks.get(row.id)?.ok) throw new Error('check_first')
            await this.activate(entry)
          } else {
            for (const fiber of (this.active.get(row.id) ?? []).toReversed()) await fiber.dispose()
            this.active.delete(row.id)
          }
          try { await this.table.put(row.id, {...entry, enabled: request.enabled}) }
          catch (error) {
            for (const fiber of (this.active.get(row.id) ?? []).toReversed()) await fiber.dispose()
            this.active.delete(row.id)
            if (row.enabled) await this.activate(entry)
            throw error
          }
        }
      }
      return {rows: await this.rows()}
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
// Apply the official decorator explicitly in this plain-JavaScript package.
Remote('manage')(Connections.prototype.manage, {kind: 'method', name: 'manage', static: false, private: false, addInitializer(fn) {initializers.push(fn)}})
