// Explicit, removable experiment against the pinned Runtime. These source
// derivatives are never applied to the normal npm assembly or its cache.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

export const runtimeCommit = '687f282e8625c6b8d11ff58211a90524be2e4317'
export const runtimeVersion = '0.2.1-rc.2'
const hash = text => createHash('sha256').update(text).digest('hex')

const referenceSetter = `setReferenceContext(reference) {
 if (this.session.header.ephemeral !== true || this.session.snapshotEvents().length !== 0 || this.referenceContext !== undefined) throw new Error("Reference context requires a fresh temporary Agent");
 const copy = structuredClone(reference);
 deepFreeze(copy);
 this.referenceContext = copy;
}`
const referenceMessages = `const sessionMessages = session.deriveMessages();
 const boundaryMessages = this.referenceContext === undefined ? sessionMessages : [
  ...sessionMessages.filter(message => message.role === "system"),
  ...this.referenceContext.messages,
  ...sessionMessages.filter(message => message.role !== "system"),
 ];`
const referenceTools = `this.referenceContext === undefined ? session.toolHistory() : {
 tools: [...new Map([...this.referenceContext.toolHistory.tools, ...session.toolHistory().tools].map(tool => [tool.name, tool])).values()],
 updates: [...this.referenceContext.toolHistory.updates, ...session.toolHistory().updates],
}`

const bundleChanges = {
  '@deepseek-ai/dsh-session': {
    beforeSHA256: '2f5dd07cb5c744a29abbb8003a8a4cefd9e582c6e2538074ca299a0ddd02a3bf',
    replacements: [
      ['var SessionStore = class extends Service {', 'var SessionStore = class extends Service {\n supportsEphemeralSessions = true;'],
      ['\tif (record.origin !== void 0', '\tif (record.ephemeral !== void 0 && typeof record.ephemeral !== "boolean") throw new Error("Invalid ephemeral session metadata");\n\tif (record.origin !== void 0'],
      ['isSeeded: meta?.isSeeded ?? false,', 'isSeeded: meta?.isSeeded ?? false,\n ...meta?.ephemeral === true ? { ephemeral: true } : {},'],
      ['return [...this.store.values()].map((entry) => entry.session);', 'return [...this.store.values()].map((entry) => entry.session).filter(session => session.header.ephemeral !== true);'],
    ],
  },
  '@deepseek-ai/dsh-agent-loop': {
    beforeSHA256: 'cf57e3ecd487ac5c2553455aaa5cef2c6fb41e6bd61be5aa455675d1d7193033',
    replacements: [
      ['var ReactLoopAgent = class {', `var ReactLoopAgent = class {\n referenceContext;\n ${referenceSetter}`],
      ['const boundaryMessages = session.deriveMessages();', referenceMessages],
      ['toolHistory: session.toolHistory(),', `toolHistory: ${referenceTools},`],
      ['async createStoredSession(session, signal) {', 'async createStoredSession(session, signal) {\n if (session.header.ephemeral === true) return void 0;'],
      ['...options.meta === void 0 ? {} : { meta: options.meta },', 'meta: { ...options.meta, ...options.ephemeral === true ? { ephemeral: true } : {} },'],
    ],
  },
  '@deepseek-ai/dsh-api-session-controller': {
    beforeSHA256: 'a9801acb577b03053c5d5a3191ff555c5f1d791d0acddec113bea4511e33b386',
    replacements: [
      ['ctx.emit("api-session/added", this.listState.summaryFor(session));', 'if (session.header.ephemeral !== true) ctx.emit("api-session/added", this.listState.summaryFor(session));'],
      ['if (ctx.sessions.get(agent.id) === agent.session) ctx.emit("api-session/added"', 'if (agent.session.header.ephemeral !== true && ctx.sessions.get(agent.id) === agent.session) ctx.emit("api-session/added"'],
      ['async fork(request) {\n\t\tconst env_1', 'async fork(request) {\n if (this.ctx.sessions.get(request.sessionId)?.header.ephemeral === true) throw new RemoteError("gateway/bad-request", "Temporary side chats cannot be saved or forked", {});\n\t\tconst env_1'],
    ],
  },
  '@deepseek-ai/dsh-session-persistence-jsonl': {
    beforeSHA256: '973dd78679b2661d6f492343bc22b124ae958aa597d3b36c698a2c650f909984',
    replacements: [
      ['async create(header, options) {', 'async create(header, options) {\n if (header.ephemeral === true) throw new Error("Temporary side chats cannot enter durable session storage");'],
    ],
  },
}

export function deriveRuntimeBundle(name, input) {
  const declaration = bundleChanges[name]
  if (!declaration || hash(input) !== declaration.beforeSHA256) throw new Error(`Unreviewed experimental Runtime input: ${name}`)
  let result = input.toString('utf8').replaceAll('\r\n', '\n')
  for (const [anchor, replacement] of declaration.replacements) {
    if (result.split(anchor).length !== 2) throw new Error(`Experimental Runtime anchor changed: ${name}: ${anchor}`)
    result = result.replace(anchor, replacement)
  }
  return result
}

const changes = [
  ['core/session', 'types.ts', [
    ['  readonly isSeeded: boolean', '  readonly isSeeded: boolean\n  /** Process-local temporary session; never accepted by durable storage. */\n  readonly ephemeral?: boolean'],
    ['    readonly isSeeded?: boolean', '    readonly isSeeded?: boolean\n    readonly ephemeral?: boolean'],
  ]],
  ['core/session', 'index.ts', [
    ['export class SessionStore extends Service {', 'export class SessionStore extends Service {\n  /** Capability required by the experimental side-chat plugin. */\n  readonly supportsEphemeralSessions = true'],
    ['  if (record.origin !== undefined', '  if (record.ephemeral !== undefined && typeof record.ephemeral !== \'boolean\') {\n    throw new Error(\'session header ephemeral must be a boolean\')\n  }\n  if (record.origin !== undefined'],
    ['      isSeeded: meta?.isSeeded ?? false,', '      isSeeded: meta?.isSeeded ?? false,\n      ...meta?.ephemeral === true ? { ephemeral: true } : {},'],
    ['    return [...this.store.values()].map(entry => entry.session)', '    return [...this.store.values()].map(entry => entry.session).filter(session => session.header.ephemeral !== true)'],
  ]],
  ['core/agent', 'index.ts', [
    ['export interface CreateAgentOptions {', 'export interface CreateAgentOptions {\n  /** Explicit in-memory session, excluded from ordinary discovery. */\n  readonly ephemeral?: boolean'],
  ]],
  ['core/agent-loop', 'index.ts', [
    ['    const persistence = this.runtime.ctx.get(\'sessionPersistence\')\n    if (persistence === undefined) return undefined', '    if (session.header.ephemeral === true) return undefined\n    const persistence = this.runtime.ctx.get(\'sessionPersistence\')\n    if (persistence === undefined) return undefined'],
    ['      ...options.meta === undefined ? {} : { meta: options.meta },', '      meta: { ...options.meta, ...options.ephemeral === true ? { ephemeral: true } : {} },'],
  ]],
  ['core/agent-loop', 'agent.ts', [
    ['export class ReactLoopAgent implements Agent {', `export class ReactLoopAgent implements Agent {
  private referenceContext?: { messages: readonly Message[]; toolHistory: NonNullable<GenerateOptions['toolHistory']> }
  ${referenceSetter.replace('reference)', "reference: { messages: readonly Message[]; toolHistory: NonNullable<GenerateOptions['toolHistory']> })")}`],
    ['const boundaryMessages = session.deriveMessages()', referenceMessages],
    ['toolHistory: session.toolHistory(),', `toolHistory: ${referenceTools},`],
  ]],
  ['api/session-controller', 'index.ts', [
    ["      ctx.emit('api-session/added', this.listState.summaryFor(session))", "      if (session.header.ephemeral !== true) ctx.emit('api-session/added', this.listState.summaryFor(session))"],
    ['      if (ctx.sessions.get(agent.id) === agent.session) {', '      if (agent.session.header.ephemeral !== true && ctx.sessions.get(agent.id) === agent.session) {'],
  ]],
  ['api/session-controller', 'commands.ts', [
    ['  async fork(request: SessionForkRequest): Promise<SessionForkValue> {', "  async fork(request: SessionForkRequest): Promise<SessionForkValue> {\n    if (this.ctx.sessions.get(request.sessionId)?.header.ephemeral === true) {\n      throw new RemoteError('gateway/bad-request', 'Temporary side chats cannot be saved or forked', {})\n    }"],
  ]],
  ['session/session-persistence-jsonl', 'index.ts', [
    ['  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {', "  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {\n    if (header.ephemeral === true) throw new Error('Temporary side chats cannot enter durable session storage')"],
  ]],
  ['client/ui-conversation', 'client/stores.ts', [
    ['  return defineStore({', '  const ordinary = defineStore({'],
    ['  })\n}\n\n/**\n * Read a Session\'s draft', "  })\n  // The side-chat resource owns these scoped stores for one window lifetime.\n  const temporary = defineStore({ ...ordinary.spec, persist: undefined })\n  return { ...ordinary, create: (scopeKey) => scopeKey?.startsWith('side-')\n    ? temporary.create(scopeKey) : ordinary.create(scopeKey) }\n}\n\n/**\n * Read a Session's draft"],
    ['  if (typeof localStorage === \'undefined\') return empty', "  if (sessionId.startsWith('side-') || typeof localStorage === 'undefined') return empty"],
    ['  if (typeof localStorage === \'undefined\') return null', "  if (sessionId.startsWith('side-') || typeof localStorage === 'undefined') return null"],
  ]],
]

export const extensionPackages = [
  { path: 'core/session', name: '@deepseek-ai/dsh-session', face: 'host' },
  { path: 'core/agent-loop', name: '@deepseek-ai/dsh-agent-loop', face: 'host' },
  { path: 'api/session-controller', name: '@deepseek-ai/dsh-api-session-controller', face: 'host' },
  { path: 'session/session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl', face: 'host' },
  { path: 'client/ui-conversation', name: '@deepseek-ai/dsh-client-ui-conversation', face: 'client' },
]

export async function prepareRuntimeExtension({ sourceRoot, output }) {
  const root = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  if (root.version !== runtimeVersion) throw new Error('Side-chat experiment requires the pinned DSH version')
  await mkdir(output) // Distinct output, never patch a shared compiler checkout.
  const sources = []
  for (const path of new Set(changes.map(([path]) => path))) {
    await cp(join(sourceRoot, 'packages', path, 'src'), join(output, path, 'src'), { recursive: true })
  }
  for (const [path, filename, replacements] of changes) {
    const target = join(output, path, 'src', filename)
    const before = await readFile(target, 'utf8')
    let after = before.replaceAll('\r\n', '\n')
    for (const [anchor, replacement] of replacements) {
      if (after.split(anchor).length !== 2) throw new Error(`Pinned side-chat extension anchor changed: ${path}/${filename}: ${anchor.slice(0, 70)}`)
      after = after.replace(anchor, replacement)
    }
    await writeFile(target, after)
    sources.push({ path: `packages/${path}/src/${filename}`, beforeSHA256: hash(before), afterSHA256: hash(after) })
  }
  await writeFile(join(output, 'extension-receipt.json'), JSON.stringify({
    schemaVersion: 1, kind: 'experimental-side-chat-runtime-source',
    baseVersion: runtimeVersion, baseCommit: runtimeCommit, sources,
  }, null, 2) + '\n')
  return sources
}
