/**
 * The DSH plugin. While switched on and configured it runs remote access for
 * this Host; its methods give the settings page the status and the owner's
 * actions, and the gate refuses them to remote devices. Every change to the
 * settings or the access key restarts remote access, which disconnects all
 * devices.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { HostStore } from './devices/store.ts'
import { createHostAdapter, type DshServices } from './host/adapter.ts'
import { RemoteAccess, type RemoteAccessStatus } from './remote-access.ts'
import { ACCESS_KEY_REF } from './typert.ts'

declare module '@deepseek-ai/cordis' {
  interface Context extends DshServices {
    credentials: { resolve(ref: string): Promise<{ readonly value: string } | undefined> }
  }
  interface Events {
    'loader/volatile-update'(): void
    'credentials/reference-updated'(ref: string): void
  }
}

export type PanelStatus =
  /** Switched off, or the relay or the access key is missing. */
  | { readonly state: 'off' }
  | { readonly state: 'failed'; readonly message: string }
  | ({ readonly state: 'on' } & RemoteAccessStatus)

const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  relay: z.string().default('').volatile(),
  /** Shown to devices; the computer's name when empty. */
  hostName: z.string().default('').volatile(),
  /** `index.html` of the published frontend; found the way the official web app finds it when empty. */
  distIndex: z.string().default(''),
})

const STATE = (): string => dshHomePath('plugins', 'dsh-remote-access', 'state.json')

/**
 * The async context the plugin was loaded in. A settings change reaches the
 * plugin inside DSH's configuration transaction; connections started there
 * would carry it into every later request, and DSH refuses a settings write
 * from inside a transaction. Remote access starts in this context instead.
 */
const loadContext = AsyncLocalStorage.snapshot()

export default class RemoteDevices extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'typertGateway', 'credentials']
  static Config = Config

  private readonly config: Schemastery.TypeT<typeof Config>
  /** The providing context's services; `this.ctx` is the caller's when reached through a proxy. */
  private readonly dsh: Context
  private readonly logger
  /** Restarts run one after another; methods wait for the latest. */
  private settled = Promise.resolve()
  private disposed = false
  private failure: string | undefined
  private access: RemoteAccess | undefined

  constructor(ctx: Context, config: Schemastery.TypeT<typeof Config>) {
    super(ctx, 'remoteDevices')
    this.config = config
    this.dsh = ctx
    this.logger = ctx.logger('eduwork-remote-access')
    const restart = (): void => { this.settled = loadContext(() => this.settled.then(() => this.restart())) }
    ctx.on('loader/volatile-update', restart)
    ctx.on('credentials/reference-updated', ref => ref === ACCESS_KEY_REF && restart())
    restart()
    ctx.effect(() => () => {
      this.disposed = true
      restart()
      return this.settled
    })
  }

  @Remote
  async status(): Promise<PanelStatus> {
    await this.settled
    if (this.access !== undefined) return { state: 'on', ...this.access.status() }
    return this.failure === undefined ? { state: 'off' } : { state: 'failed', message: this.failure }
  }

  @Remote
  async createInvite(): Promise<PanelStatus> {
    (await this.running()).createInvite()
    return this.status()
  }

  @Remote
  async cancelInvite(): Promise<PanelStatus> {
    (await this.running()).cancelInvite()
    return this.status()
  }

  @Remote
  async decide(key: string, approved: boolean): Promise<PanelStatus> {
    (await this.running()).decide(key, approved)
    return this.status()
  }

  @Remote
  async revoke(key: string): Promise<PanelStatus> {
    await (await this.running()).revoke(key)
    return this.status()
  }

  private async running(): Promise<RemoteAccess> {
    await this.settled
    if (this.access === undefined) throw new Error('remote access is not running')
    return this.access
  }

  private async restart(): Promise<void> {
    this.access?.stop()
    this.access = undefined
    this.failure = undefined
    const { enabled, relay, hostName, distIndex } = this.config
    if (this.disposed || !enabled.get() || relay.get() === '') return
    try {
      const accessKey = (await this.dsh.credentials.resolve(ACCESS_KEY_REF))?.value
      if (accessKey === undefined) return
      const access = new RemoteAccess({
        adapter: createHostAdapter(this.dsh, distIndex || frontendIndex()),
        store: await HostStore.open(STATE()),
        relay: relay.get(),
        accessKey,
        hostName: hostName.get() || hostname(),
        warn: message => this.logger.warn(message),
      })
      access.start()
      this.access = access
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(message)
      this.failure = message
    }
  }
}

/** The published frontend the Host serves, resolved the way the official web app does. */
function frontendIndex(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
}
