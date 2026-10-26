/**
 * The DSH plugin. While switched on and configured it runs remote access for
 * this Host; its methods give the settings page the status and the owner's
 * actions, and the gate refuses them to remote devices. Every change to the
 * settings or the access key restarts remote access, which disconnects all
 * devices.
 *
 * A distribution may also set an organization: a relay the organization
 * runs, which admits a Host by the ID Token of its sign-in (dsh-oidc). Unless
 * the user chooses their own relay and access key instead, remote access then
 * uses that relay, which the settings page cannot change, so the token goes
 * nowhere else, and follows that sign-in, starting with it and stopping with it.
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
import { relayBase } from './protocol/relay.ts'
import { probe, type Admission, type LinkState } from './relay-link/link.ts'
import { RemoteAccess, type RemoteAccessStatus } from './remote-access.ts'
import { ACCESS_KEY_REF } from './typert.ts'

/** The part of dsh-oidc's Host service used here. */
interface OidcAccounts {
  status(profileID: string): Promise<Account>
  /** Opens the system browser on a desktop; a web Host leaves the navigation to the page. */
  begin(profileID: string): Promise<{ readonly mode: string; readonly authorizationURL?: string }>
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

interface Account { readonly state: string; readonly displayName: string }

/** The organization running the relay, when the distribution set one, and whether the user is signed in to it. */
export interface Organization { readonly name: string; readonly relay: string; readonly signedIn: boolean }

/** Where this Host registers and what admits it there. */
interface Route { readonly relay: string; credential(): Promise<Admission | undefined> }

/** What testing the relay found. */
export type RelayTest =
  /** Nothing to test until the relay and the access key are set. */
  | { readonly state: 'unconfigured' }
  /** Nothing to test until the organization's sign-in is. */
  | { readonly state: 'sign-in' }
  /** The relay's address did not answer. */
  | { readonly state: 'unreachable' }
  /** The relay answered; how it took this Host's registration, or how the running link stands. */
  | { readonly state: 'reached'; readonly link: LinkState }

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
  /** With an organization set, use its relay and sign-in rather than the relay and access key above. */
  useOrganization: z.boolean().default(true).volatile(),
  /** `index.html` of the published frontend; found the way the official web app finds it when empty. */
  distIndex: z.string().default(''),
  /** Set by a distribution, not the settings page: when `relay` is set, it is offered instead of the relay and the access key above. */
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
  private readonly restartLater: () => void
  private disposed = false
  private failed = false
  private signedOut = false
  /** This Host's identity and devices, opened once for remote access and relay tests alike, so they never create two. */
  private store: Promise<HostStore> | undefined
  /** Relay tests in progress. A probe would take over the registration of a link starting meanwhile, so a start stops them. */
  private readonly probes = new Set<AbortController>()
  private organization: Organization | undefined
  private access: RemoteAccess | undefined
  private accounts: OidcAccounts | undefined

  constructor(ctx: Context, config: Schemastery.TypeT<typeof Config>) {
    super(ctx, 'remoteDevices')
    this.config = config
    this.dsh = ctx
    this.logger = ctx.logger('eduwork-remote-access')
    const restart = this.restartLater = (): void => { this.settled = loadContext(() => this.settled.then(() => this.restart())) }
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

  /** Start again now, e.g. after the relay stayed out of reach or refused this Host. */
  @Remote
  async retry(): Promise<PanelStatus> {
    this.restartLater()
    return this.status()
  }

  /**
   * Whether the relay answers, and whether it admits this Host as configured,
   * enabled or not. While remote access runs, its link tells the second part.
   */
  @Remote
  async test(): Promise<RelayTest> {
    const probing = new AbortController()
    this.probes.add(probing)
    try {
      return await this.testRelay(probing.signal)
    } finally {
      this.probes.delete(probing)
    }
  }

  private async testRelay(signal: AbortSignal): Promise<RelayTest> {
    await this.settled
    const route = await this.route(await this.account())
    if (route === undefined) return { state: 'unconfigured' }
    if (route === 'sign-in') return { state: route }
    const relay = relayBase(route.relay)
    const answered = relay !== undefined && await fetch(new URL('healthz', relay), { signal: AbortSignal.timeout(10_000) }).then(response => response.ok, () => false)
    if (!answered) return { state: 'unreachable' }
    // Stopped meanwhile, perhaps with the plugin, whose next instance owns the state file.
    if (signal.aborted) return { state: 'reached', link: this.runningLink() ?? { state: 'stopped' } }
    const { identity } = await this.openStore()
    const running = this.runningLink()
    if (running !== undefined) return { state: 'reached', link: running }
    const link = await probe({ relay, credential: route.credential, identity }, signal)
    if (link.state === 'lapsed') this.organization = { ...this.organization!, signedIn: false }
    return { state: 'reached', link: this.runningLink() ?? link }
  }

  /** The state of remote access's own link, while it runs. */
  private runningLink(): LinkState | undefined {
    return this.access?.status().link
  }

  /** Start signing in to the organization; remote access follows once it completes. Returns where a web Host's page goes to sign in. */
  @Remote
  async signIn(): Promise<string | undefined> {
    const { accounts } = this
    if (accounts === undefined) throw new Error(`sign-in "${this.config.organization.oidcProfileId}" is not available`)
    return (await accounts.begin(this.config.organization.oidcProfileId)).authorizationURL
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
    this.stopProbes()
    this.access?.stop()
    this.access = undefined
    this.failed = false
    this.signedOut = false
    try {
      const account = await this.account()
      if (this.disposed || !this.config.enabled.get()) return
      const route = await this.route(account)
      if (route === 'sign-in') this.signedOut = true
      if (typeof route !== 'object') return
      const access = new RemoteAccess({
        adapter: createHostAdapter(this.dsh, this.config.distIndex || frontendIndex()),
        store: await this.openStore(),
        relay: route.relay,
        credential: route.credential,
        hostName: this.config.hostName.get() || hostname(),
        warn: message => this.logger.warn(message),
      })
      this.stopProbes()
      access.start()
      this.access = access
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error))
      this.failed = true
    }
  }

  private openStore(): Promise<HostStore> {
    return this.store ??= HostStore.open(STATE()).catch((error: unknown) => {
      this.store = undefined
      throw error
    })
  }

  private stopProbes(): void {
    for (const probing of this.probes) probing.abort()
  }

  /** The organization's sign-in, when the distribution set an organization and dsh-oidc runs; also what the settings page shows of it. */
  private async account(): Promise<Account | undefined> {
    const { relay, oidcProfileId } = this.config.organization
    if (relay === '') {
      this.organization = undefined
      return undefined
    }
    // Using one's own relay does not depend on it; the organization's relay fails without it.
    const account = await this.accounts?.status(oidcProfileId).catch((error: Error) => void this.logger.warn(error.message))
    this.organization = { name: account?.displayName ?? oidcProfileId, relay, signedIn: account?.state === 'connected' }
    return account
  }

  /** Where this Host registers and what admits it there; none until the relay and the access key are set, `sign-in` until the organization's sign-in is. */
  private async route(account: Account | undefined): Promise<Route | 'sign-in' | undefined> {
    const { organization, useOrganization } = this.config
    if (organization.relay === '' || !useOrganization.get()) {
      const relay = this.config.relay.get()
      const credential = relay === '' ? undefined : await this.accessKey()
      return credential && { relay, credential }
    }
    const { accounts } = this
    if (accounts === undefined || account === undefined) throw new Error(`sign-in "${organization.oidcProfileId}" is not available`)
    return account.state === 'connected' ? { relay: organization.relay, credential: member(accounts, organization.oidcProfileId) } : 'sign-in'
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
