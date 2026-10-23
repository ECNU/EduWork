/**
 * The DSH plugin. While switched on and configured it runs remote access for
 * this Host; its methods give the settings page the status and the owner's
 * actions, and the gate refuses them to remote devices. Every change to the
 * settings or the access key restarts remote access, which disconnects all
 * devices.
 *
 * A distribution may set an organization instead: a relay the organization
 * runs, which admits a Host by the ID Token of its sign-in (dsh-oidc). The
 * relay is then fixed, so the token goes nowhere else, and remote access
 * follows that sign-in, starting with it and stopping with it.
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
import type { Admission } from './relay-link/link.ts'
import { RemoteAccess, type RemoteAccessStatus } from './remote-access.ts'
import { ACCESS_KEY_REF } from './typert.ts'

/** The part of dsh-oidc's Host service used here. */
interface OidcAccounts {
  status(profileID: string): Promise<{ readonly state: string; readonly displayName: string }>
  identityToken(profileID: string): Promise<{ readonly token: string; readonly expiresAt: number }>
}

declare module '@deepseek-ai/cordis' {
  interface Context extends DshServices {
    credentials: { resolve(ref: string): Promise<{ readonly value: string } | undefined> }
    oidcAccounts: OidcAccounts
  }
  interface Events {
    'loader/volatile-update'(): void
    'credentials/reference-updated'(ref: string): void
    'oidc/accounts-changed'(event: { readonly profileID: string }): void
  }
}

/** The organization running the relay, when the distribution set one. */
export interface Organization { readonly name: string; readonly relay: string }

export type PanelStatus = (
  /** Switched off, or the relay or the access key is missing. */
  | { readonly state: 'off' }
  /** Waiting for the user to sign in to the organization. */
  | { readonly state: 'sign-in' }
  /** Could not start; the reason is in the log. */
  | { readonly state: 'failed' }
  | ({ readonly state: 'on' } & RemoteAccessStatus)
) & { readonly organization?: Organization }

const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  relay: z.string().default('').volatile(),
  /** Shown to devices; the computer's name when empty. */
  hostName: z.string().default('').volatile(),
  /** `index.html` of the published frontend; found the way the official web app finds it when empty. */
  distIndex: z.string().default(''),
  /** Set by a distribution, not the settings page: when `relay` is set, it replaces the relay and the access key above. */
  organization: z.object({
    relay: z.string().default(''),
    /** The dsh-oidc profile whose sign-in admits this Host. */
    oidcProfileId: z.string().default(''),
  }),
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
  private failed = false
  private signedOut = false
  private organization: Organization | undefined
  private access: RemoteAccess | undefined
  private accounts: OidcAccounts | undefined

  constructor(ctx: Context, config: Schemastery.TypeT<typeof Config>) {
    super(ctx, 'remoteDevices')
    this.config = config
    this.dsh = ctx
    this.logger = ctx.logger('eduwork-remote-access')
    const restart = (): void => { this.settled = loadContext(() => this.settled.then(() => this.restart())) }
    ctx.on('loader/volatile-update', restart)
    ctx.on('credentials/reference-updated', ref => ref === ACCESS_KEY_REF && restart())
    const { oidcProfileId } = config.organization
    if (oidcProfileId !== '') {
      ctx.on('oidc/accounts-changed', event => event.profileID === oidcProfileId && restart())
      ctx.inject(['oidcAccounts'], inner => {
        this.accounts = inner.oidcAccounts
        restart()
        inner.effect(() => () => {
          this.accounts = undefined
          restart()
        })
      })
    }
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
    const organization = this.organization && { organization: this.organization }
    if (this.access !== undefined) return { state: 'on', ...this.access.status(), ...organization }
    if (this.signedOut) return { state: 'sign-in', ...organization }
    return { state: this.failed ? 'failed' : 'off', ...organization }
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
    this.failed = false
    this.signedOut = false
    const { enabled, hostName, distIndex, organization } = this.config
    const { accounts } = this, profileID = organization.oidcProfileId
    const managed = organization.relay !== ''
    const relay = managed ? organization.relay : this.config.relay.get()
    this.organization = managed ? { name: profileID, relay } : undefined
    try {
      const account = managed ? await accounts?.status(profileID) : undefined
      if (account !== undefined) this.organization = { name: account.displayName, relay }
      if (this.disposed || !enabled.get() || relay === '') return
      let credential: (() => Promise<Admission | undefined>) | undefined
      if (!managed) credential = await this.accessKey()
      else if (accounts === undefined) throw new Error(`sign-in "${profileID}" is not available`)
      else if (account!.state === 'connected') credential = member(accounts, profileID)
      else this.signedOut = true
      if (credential === undefined) return
      const access = new RemoteAccess({
        adapter: createHostAdapter(this.dsh, distIndex || frontendIndex()),
        store: await HostStore.open(STATE()),
        relay,
        credential,
        hostName: hostName.get() || hostname(),
        warn: message => this.logger.warn(message),
      })
      access.start()
      this.access = access
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error))
      this.failed = true
    }
  }

  /** The access key in DSH's credentials; undefined until one is saved. */
  private async accessKey(): Promise<(() => Promise<Admission>) | undefined> {
    const accessKey = (await this.dsh.credentials.resolve(ACCESS_KEY_REF))?.value
    return accessKey === undefined ? undefined : async () => ({ credential: { accessKey } })
  }
}

/** The current ID Token of the organization's sign-in, for every registration; none once only signing in again brings one. */
function member(accounts: OidcAccounts, profileID: string): () => Promise<Admission | undefined> {
  return async () => {
    try {
      const { token, expiresAt } = await accounts.identityToken(profileID)
      return { credential: { idToken: token }, expiresAt }
    } catch (error) {
      // The sign-in ended, or its issuer no longer renews the ID Token: only signing in again helps. Anything else is tried again.
      const { code } = error as { code?: unknown }
      if (code === 'oidc_login_required' || code === 'oidc_identity_token_unavailable') return undefined
      throw error
    }
  }
}

/** The published frontend the Host serves, resolved the way the official web app does. */
function frontendIndex(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
}
