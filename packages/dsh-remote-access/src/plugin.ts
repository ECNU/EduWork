/**
 * The DSH plugin. While switched on and configured it runs remote access for
 * this Host; its methods give the settings page the status and the owner's
 * actions, and the gate refuses them to remote devices. Every settings change
 * restarts remote access, which disconnects all devices.
 */
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

declare module '@deepseek-ai/cordis' {
  interface Context extends DshServices {}
  interface Events {
    'loader/volatile-update'(): void
  }
}

/** The page reads the other settings itself; the access key is redacted from it, so only its presence is told. */
export type PanelStatus = { readonly accessKeySet: boolean } & (
  /** Switched off, or the relay or the access key is missing. */
  | { readonly state: 'off' }
  | { readonly state: 'failed'; readonly message: string }
  | ({ readonly state: 'on' } & RemoteAccessStatus))

const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  relay: z.string().default('').volatile(),
  accessKey: z.string().role('secret').default('').volatile(),
  /** Shown to devices; the computer's name when empty. */
  hostName: z.string().default('').volatile(),
  /** `index.html` of the published frontend; found the way the official web app finds it when empty. */
  distIndex: z.string().default(''),
})

const STATE = (): string => dshHomePath('plugins', 'dsh-remote-access', 'state.json')

export default class RemoteDevices extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'typertGateway']
  static Config = Config

  private readonly config: Schemastery.TypeT<typeof Config>
  /** The providing context's services; `this.ctx` is the caller's when reached through a proxy. */
  private readonly dsh: DshServices
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
    this.logger = ctx.logger('remote-access')
    const restart = (): void => { this.settled = this.settled.then(() => this.restart()) }
    ctx.on('loader/volatile-update', restart)
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
    const accessKeySet = this.config.accessKey.get() !== ''
    if (this.access !== undefined) return { accessKeySet, state: 'on', ...this.access.status() }
    return this.failure === undefined ? { accessKeySet, state: 'off' } : { accessKeySet, state: 'failed', message: this.failure }
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
    const { enabled, relay, accessKey, hostName, distIndex } = this.config
    if (this.disposed || !enabled.get() || relay.get() === '' || accessKey.get() === '') return
    try {
      const access = new RemoteAccess({
        adapter: createHostAdapter(this.dsh, distIndex || frontendIndex()),
        store: await HostStore.open(STATE()),
        relay: relay.get(),
        accessKey: accessKey.get(),
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
