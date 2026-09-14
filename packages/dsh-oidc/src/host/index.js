import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { apply as applyEnterpriseProvider } from './provider/index.js'
import { NativeOidcBackend, WebOidcBackend } from './oidc.js'
import { DesktopOidcBackend } from './desktop-oidc.js'
import { enterpriseProviderConfig, loadEnterpriseProfiles, publicProfile } from './profile.js'

export const name = 'dsh-oidc'
const remoteInitializers = []

export class OidcAccountService extends TypertRemoteService {
  static inject = ['credentials', 'llm']

  constructor(ctx, config = {}) {
    super(ctx, 'oidcAccounts')
    for (const initialize of remoteInitializers) initialize.call(this)
    this.profiles = loadEnterpriseProfiles(config)
    if (this.profiles.size === 0 && config.allowEmptyProfiles !== true) throw new Error('dsh-oidc requires at least one Enterprise Profile')
    this.uiMode = ['external', 'models-only'].includes(config.uiMode) ? config.uiMode : 'standard'
    this.manageProductBrand = config.manageProductBrand !== false
    if (config.configFile !== undefined) {
      const source = config.configFile
      if (!source || typeof source.path !== 'string' || !source.path || typeof source.examplesPath !== 'string' || !source.examplesPath) throw new Error('Invalid enterprise configuration file location')
      this.configFile = { path: source.path, examplesPath: source.examplesPath }
      ctx.inject(['desktopServices'], inner => {
        if (typeof inner.desktopServices.openConfiguration !== 'function') return
        const open = target => inner.desktopServices.openConfiguration(target)
        this.openConfigTarget = open
        inner.effect(() => () => {
          if (this.openConfigTarget === open) this.openConfigTarget = undefined
        }, 'dsh-oidc: configuration file service')
      })
    }
    this.accountStates = new Map()
    const provider = applyEnterpriseProvider(ctx, {
      ...enterpriseProviderConfig(this.profiles),
      resolveCredential: async providerID => {
        const profile = [...this.profiles.values()].find(value => value.provider?.id === providerID)
        if (!profile) return undefined
        if (this.backend instanceof NativeOidcBackend) return ctx.credentials.resolve(profile.keyBinding.credentialRef)
        if (this.backend instanceof WebOidcBackend) return this.backend.resolveBoundCredential(profile.id, {
          credentialRef: profile.keyBinding.credentialRef, runtimeBaseURL: profile.provider.baseURL,
        })
      },
    })
    const backendOptions = {
          authorizedOrigins: config.authorizedOrigins,
          accountChanged: status => this.notifyAccount(status),
          updateProvider: profile => {
            const profiles = new Map(this.profiles)
            profiles.set(profile.id, profile)
            provider.replaceConfig(enterpriseProviderConfig(profiles))
          },
        }
    if (config.backend === 'native') this.backend = new NativeOidcBackend(ctx, this.profiles)
    else if (config.backend === 'desktop') {
      this.backend = new DesktopOidcBackend(ctx, this.profiles, config.desktop ?? {}, backendOptions)
      ctx.inject(['desktopServices'], inner => {
        this.backend.openExternal = url => inner.desktopServices.openExternal(url)
        inner.effect(() => () => {
          this.backend.openExternal = undefined
          return Promise.all([...this.backend.attempts.values()].filter(value => value.state === 'pending').map(value => this.backend.cancelLogin(value.loginID)))
        }, 'dsh-oidc: external browser service')
      })
    } else {
      this.backendReady = new Promise(resolve => {
        ctx.inject(['webServer'], inner => {
          const backend = new WebOidcBackend(inner, this.profiles, config.web ?? {}, backendOptions)
          this.backend = backend
          resolve()
          inner.effect(() => () => { if (this.backend === backend) this.backend = undefined }, 'dsh-oidc: web backend')
        })
      })
    }
  }

  async callBackend(method, ...args) {
    if (this.configFile && ['activate', 'configure', 'addCustom', 'updateCustom', 'removeProfile', 'configureModels'].includes(method)) throw new Error('Organization services are managed in the configuration file; edit it and restart the application')
    await this.backendReady
    if (typeof this.backend?.[method] !== 'function') throw new Error('This OIDC operation is unavailable in the configured host')
    return this.backend[method](...args)
  }

  configuration() {
    return Promise.resolve({
      schemaVersion: 'dsh-oidc/v1alpha1',
      uiMode: this.uiMode,
      manageProductBrand: this.manageProductBrand,
      ...(this.configFile ? { configFile: { ...this.configFile, canOpen: typeof this.openConfigTarget === 'function' } } : {}),
      profiles: [...this.profiles.values()].map(publicProfile),
    })
  }

  async openConfiguration(target) {
    if (!['config', 'examples'].includes(target)) throw new Error('只能打开应用配置文件或示例目录。')
    if (!this.configFile || typeof this.openConfigTarget !== 'function') throw new Error('当前宿主不支持直接打开配置文件，请按配置路径手动打开。')
    try { await this.openConfigTarget(target) }
    catch { throw new Error('未能打开配置文件或示例目录，请重试或检查系统文件关联。') }
    return { opened: true }
  }

  notifyAccount(status) {
    if (this.accountStates.get(status.profileID) !== status.state) {
      this.accountStates.set(status.profileID, status.state)
      this.ctx.emit('oidc/accounts-changed', { profileID: status.profileID, state: status.state })
    }
    return status
  }
  async status(profileID) { return this.notifyAccount(await this.callBackend('status', profileID)) }
  resources(profileID) { return this.callBackend('resources', profileID) }
  // Host-only capability: deliberately absent from Remote markers and Typert.
  authorizedFetch(profileID, endpoint, init) {
    return this.callBackend('authorizedFetch', profileID, endpoint, init)
  }
  modelResourceFetch(profileID, relativePath, options) {
    return this.callBackend('modelResourceFetch', profileID, relativePath, options)
  }
  // Host-only credential snapshot for optional adapters; never exposed via RPC.
  async resolveBoundCredential(profileID, expected) {
    await this.backendReady
    return this.backend instanceof WebOidcBackend ? this.backend.resolveBoundCredential(profileID, expected) : undefined
  }
  async begin(profileID) {
    const result = await this.callBackend('begin', profileID)
    if (result.mode === 'completed') this.notifyAccount(result.status)
    return result
  }
  loginStatus(loginID) { return this.callBackend('loginStatus', loginID) }
  cancelLogin(loginID) { return this.callBackend('cancelLogin', loginID) }
  async reconcile(profileID, options) { return this.notifyAccount(await this.callBackend('reconcile', profileID, options)) }
  async selectEnterpriseModel(profileID, options = {}) {
    const status = await this.callBackend('status', profileID)
    const profile = this.profiles.get(profileID)
    if (!profile?.provider || status.state !== 'connected' || !status.credentialReady) throw new Error('请先完成企业登录和模型凭据连接，再选择企业模型。')
    const defaults = this.ctx.get('agentDefaultModel')
    if (typeof defaults?.saveSelection !== 'function') throw new Error('已连接企业模型；当前宿主不支持自动选择，请从模型菜单中选择。')
    const original = defaults.currentSelection()
    if (options.onlyIfMissing === true) {
      const current = original
      if (current?.provider && current?.model) {
        try { await this.ctx.llm.resolveCallConfig(current); return { changed: false } }
        catch { /* The old edition's provider may no longer be assembled. */ }
      }
    }
    const models = await this.ctx.llm.listModels(profile.provider.id)
    for (const model of models) {
      let resolved
      try { resolved = await this.ctx.llm.resolveCallConfig({ provider: profile.provider.id, model: model.id }) }
      catch { continue }
      const selection = { provider: resolved.provider, model: resolved.model,
        ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: String(resolved.reasoningEffort) }) }
      // A slow discovery must not overwrite a newer personal choice or finish
      // activation after the account has been signed out elsewhere.
      if (options.onlyIfMissing === true && JSON.stringify(defaults.currentSelection()) !== JSON.stringify(original)) return { changed: false }
      const latest = await this.callBackend('status', profileID)
      if (latest.state !== 'connected' || !latest.credentialReady) throw new Error('企业连接状态已变化，请重新检查连接后选择模型。')
      await defaults.saveSelection(selection)
      return { selection, changed: true }
    }
    throw new Error('企业登录已完成，但尚未找到可用模型。请刷新模型目录或联系服务管理员。')
  }
  async logout(profileID) { return this.notifyAccount(await this.callBackend('logout', profileID)) }
  async management() {
    const result = await this.callBackend('management')
    return this.configFile ? { ...result, capabilities: { ...result.capabilities, manageProfiles: false, manageModels: false } } : result
  }
  activate(profileID) { return this.callBackend('activate', profileID) }
  configure(profileID) { return this.callBackend('configure', profileID) }
  addCustom(baseURL) { return this.callBackend('addCustom', baseURL) }
  updateCustom(profileID, baseURL) { return this.callBackend('updateCustom', profileID, baseURL) }
  removeProfile(profileID) { return this.callBackend('removeProfile', profileID) }
  configureModels(profileID, modelMode, models) { return this.callBackend('configureModels', profileID, modelMode, models) }
  restart() { return this.callBackend('restart') }
}

for (const method of [
  'configuration', 'openConfiguration', 'status', 'resources', 'begin', 'loginStatus', 'cancelLogin', 'reconcile', 'selectEnterpriseModel', 'logout', 'management',
  'activate', 'configure', 'addCustom', 'updateCustom', 'removeProfile', 'configureModels', 'restart',
]) {
  Remote(method)(OidcAccountService.prototype[method], {
    kind: 'method', name: method, static: false, private: false,
    addInitializer(initializer) { remoteInitializers.push(initializer) },
  })
}

export default OidcAccountService
export { enterpriseProviderConfig, loadEnterpriseProfiles, normalizeEnterpriseProfile, publicProfile } from './profile.js'
export { NativeOidcBackend, WebOidcBackend } from './oidc.js'
export { DesktopOidcBackend } from './desktop-oidc.js'
export { EnterpriseModelTransforms } from './provider/transforms.js'
