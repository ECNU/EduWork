import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import writeFileAtomic from 'write-file-atomic'
import * as electron from 'electron'
import { createBuiltinPasswordAgent } from './builtin-password-agent.mjs'
import { createElectronLogin } from '../../packages/dsh-password-manager/src/electron-login.mjs'
import { BrowserPasswordStore } from '../vendor/orca/src/main/browser-passwords/browser-password-store.ts'
import { BrowserPasswordLoginTracker } from '../vendor/orca/src/main/browser-passwords/browser-password-login-tracker.ts'
import { decideBrowserPasswordSave } from '../vendor/orca/src/main/browser-passwords/browser-password-save-decision.ts'
import { toBrowserPasswordOrigin } from '../vendor/orca/src/main/browser-passwords/browser-password-origin.ts'
import { setSecretStore } from '../vendor/orca/src/shared/secret-store.ts'
import { BROWSER_PASSWORDS_GUEST_CHANNELS as IN, BROWSER_PASSWORDS_TO_GUEST_CHANNELS as OUT } from '../vendor/orca/src/shared/browser-passwords-types.ts'
import { readBrowserPasswordCapture, readBrowserPasswordSubmitted, readBrowserPasswordFormSummaries,
  readBrowserPasswordFieldFocused, readBrowserPasswordFillResult, readBrowserPasswordToken } from '../vendor/orca/src/main/browser-passwords/browser-password-guest-payloads.ts'

export const PASSWORD_UI = 'eduwork:browser-passwords:ui'
export const PASSWORD_ACTION = 'eduwork:browser-passwords:action'

// Host adapter for Orca's detector, login tracker, save decision and encrypted store.
// The desktop owns the UI; the guest receives only a user-selected fill for its current frame.
export function createBrowserPasswords({ getWindow, getDestination, filePath = join(app.getPath('userData'), 'browser-passwords.json') }) {
  setSecretStore({
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: value => safeStorage.encryptString(value),
    decryptString: value => safeStorage.decryptString(value),
    describeProtectionGap: () => process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
      ? '系统密钥环不可用，无法保存密码。' : null,
  })
  const vault = new BrowserPasswordStore(filePath)
  const settingsPath = filePath + '.settings.json'
  let managerEnabled = true, agentEnabled = false
  try { const saved = JSON.parse(readFileSync(settingsPath, 'utf8')); managerEnabled = saved.enabled !== false; agentEnabled = saved.allowAgentLogin === true } catch { /* Disabled until explicitly enabled. */ }
  const agent = createBuiltinPasswordAgent({ vault, getDestination, isEnabled: () => managerEnabled && agentEnabled, login: createElectronLogin(electron),
    async approve({ origin, entries, signal }) {
      const parent = getWindow()
      if (!parent || parent.isDestroyed()) return null
      const { response } = await electron.dialog.showMessageBox(parent, { type: 'question', title: '允许 Agent 登录',
        message: `允许当前会话使用已保存账号登录 ${origin}？`,
        detail: '本次会话内记住选择。密码由本机填写，工具只返回登录状态。',
        buttons: ['取消', ...entries.map(entry => entry.username || '未命名账号')], defaultId: 0, cancelId: 0, noLink: true, signal })
      return entries[response - 1] ?? null
    } })
  const states = new Map(), handlers = [], pending = new Map()
  const emit = value => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(PASSWORD_UI, value)
  }
  const hide = state => { clearTimeout(state.blurTimer); state.blurTimer = null; state.focus = null; emit({ kind: 'hide', guestId: state.guest.id }) }
  const error = text => emit({ kind: 'error', text })
  const settings = request => {
    if (!request || Object.keys(request).some(key => !['op', 'enabled', 'id', 'origin'].includes(key))) return { status: 'invalid-request' }
    if (request.op === 'builtin-set' || request.op === 'builtin-manager-set') {
      if (typeof request.enabled !== 'boolean') return { status: 'invalid-request' }
      const nextManager = request.op === 'builtin-manager-set' ? request.enabled : managerEnabled
      if (!nextManager && request.op === 'builtin-set' && request.enabled) return { status: 'operation-failed' }
      const nextAgent = request.op === 'builtin-set' ? request.enabled : agentEnabled
      try { writeFileAtomic.sync(settingsPath, JSON.stringify({ enabled: nextManager, allowAgentLogin: nextAgent }), { mode: 0o600 }) }
      catch { return { status: 'operation-failed' } }
      agentEnabled = nextAgent; managerEnabled = nextManager; agent.revoke()
      if (request.op === 'builtin-manager-set') {
        for (const job of pending.values()) clearTimeout(job.timer)
        pending.clear()
        for (const state of states.values()) {
          state.epoch++; state.offer = null; state.tracker.dispose(); hide(state)
          if (!state.guest.isDestroyed()) state.guest.send(managerEnabled ? OUT.enable : OUT.disable, { reportPageForms: false })
        }
      }
    } else if (request.op === 'builtin-delete') {
      if (typeof request.id !== 'string') return { status: 'invalid-request' }
      agent.revoke()
      if (!vault.remove(request.id).ok) return { status: 'operation-failed' }
    } else if (request.op === 'builtin-allow-site') {
      if (typeof request.origin !== 'string' || !vault.removeNever(request.origin).ok) return { status: 'operation-failed' }
    } else if (request.op === 'builtin-revoke') agent.revoke()
    else if (request.op === 'builtin-manage') manage()
    else if (request.op !== 'builtin-snapshot') return { status: 'invalid-request' }
    const entries = vault.list(), never = vault.listNever()
    if (!entries.ok || !never.ok) return { status: 'vault-unavailable' }
    return { status: 'available', enabled: agentEnabled, managerEnabled,
      entries: entries.value.map(({ id, origin, username }) => ({ id, origin, username })), never: never.value }
  }
  const context = event => {
    if (!managerEnabled) return null
    const state = states.get(event.sender.id), frame = event.senderFrame
    if (!state || !frame || frame !== state.guest.mainFrame || frame.detached) return null
    const origin = toBrowserPasswordOrigin(frame.origin)
    return origin ? { state, origin, frame } : null
  }
  const on = (channel, fn) => {
    const listener = (event, payload) => { const ctx = context(event); if (ctx) fn(ctx, payload) }
    ipcMain.on(channel, listener); handlers.push([channel, listener])
  }
  on(IN.typed, ({ state, origin }, raw) => { const p = readBrowserPasswordCapture(raw); if (p) state.tracker.typed(origin, p) })
  on(IN.submitted, ({ state, origin }, raw) => { const p = readBrowserPasswordSubmitted(raw); if (p) { hide(state); state.tracker.submitted(origin, p) } })
  on(IN.formGone, ({ state }, raw) => { const p = readBrowserPasswordToken(raw, 'formSignature'); if (p) state.tracker.formGone(p) })
  on(IN.pageForms, ({ state }, raw) => { const p = readBrowserPasswordFormSummaries(raw); if (p) state.tracker.pageForms(p) })
  on(IN.fieldFocused, ({ state, origin, frame }, raw) => {
    const focus = readBrowserPasswordFieldFocused(raw)
    if (!focus || focus.role === 'new-password') return
    clearTimeout(state.blurTimer); state.blurTimer = null
    const matches = vault.findForOrigin(origin)
    if (!matches.ok) { error('系统密码库暂不可用。'); return }
    // First integration offers exact-origin matches; no cross-subdomain expansion.
    const entries = matches.value.exact
    state.focus = { ...focus, frame, origin, epoch: state.epoch, shownAt: Date.now() }
    if (entries.length) emit({ kind: 'choose', guestId: state.guest.id, fieldToken: focus.fieldToken,
      rect: focus.rect, viewportWidth: focus.viewportWidth, origin,
      entries: entries.map(({ id, username }) => ({ id, username })) })
  })
  on(IN.fieldBlurred, ({ state }, raw) => {
    // Give the trusted picker one focus-transfer turn; a click elsewhere closes it.
    if (raw?.reason !== 'focusout') hide(state)
    else { clearTimeout(state.blurTimer); state.blurTimer = setTimeout(() => hide(state), 200) }
  })
  on(IN.fillResult, ({ state }, raw) => {
    const result = readBrowserPasswordFillResult(raw), job = result && pending.get(result.requestId)
    if (!job || job.state !== state || job.epoch !== state.epoch) return
    clearTimeout(job.timer); pending.delete(result.requestId)
    if (result.ok) { vault.markUsed(job.entryId); emit({ kind: 'filled', guestId: state.guest.id }) }
    else error('未填写：输入框已变化或不可编辑，请重新选择账号。')
  })

  function offer(state, login) {
    if (!managerEnabled) return
    const never = vault.isNever(login.origin)
    if (!never.ok || never.value) return
    const matches = vault.findForOrigin(login.origin)
    if (!matches.ok) return
    const saved = matches.value.exact.map(entry => {
      const secret = vault.getPassword(entry.id)
      return secret.ok ? { id: entry.id, username: entry.username, password: secret.value } : null
    }).filter(Boolean)
    const decision = decideBrowserPasswordSave({ username: login.username,
      password: login.capture.newPassword || login.capture.password || '', formKind: login.capture.kind, saved })
    if (decision.kind === 'none') { if (decision.usedEntryId) vault.markUsed(decision.usedEntryId); return }
    state.offer = { ...decision, origin: login.origin, token: randomUUID(), epoch: state.epoch }
    emit({ kind: decision.kind, guestId: state.guest.id, token: state.offer.token,
      origin: login.origin, username: decision.username })
  }

  function attach(guest) {
    if (states.has(guest.id)) return () => {}
    const state = { guest, epoch: 0, focus: null, offer: null, listeners: [] }
    state.tracker = new BrowserPasswordLoginTracker({ onLoginSucceeded: login => offer(state, login),
      now: Date.now, schedule: (ms, run) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer) } })
    states.set(guest.id, state)
    const listen = (event, fn) => { guest.on(event, fn); state.listeners.push([event, fn]) }
    listen('dom-ready', () => {
      state.tracker.documentReady()
      if (managerEnabled && toBrowserPasswordOrigin(guest.getURL())) guest.send(OUT.enable, { reportPageForms: state.tracker.wantsPageForms() })
    })
    listen('did-start-navigation', details => {
      if (!details.isMainFrame || details.isSameDocument) return
      state.epoch++; state.offer = null; hide(state)
      for (const [id, job] of pending) if (job.state === state) { clearTimeout(job.timer); pending.delete(id) }
      state.tracker.navigationStarted(details.initiator != null)
    })
    listen('did-navigate', (_event, _url, status) => state.tracker.navigated(status))
    listen('did-fail-load', (_event, _code, _text, _url, main) => { if (main) state.tracker.navigationFailed() })
    const dispose = () => {
      state.tracker.dispose(); state.offer = null; hide(state); states.delete(guest.id)
      for (const [event, fn] of state.listeners) guest.removeListener(event, fn)
      for (const [id, job] of pending) if (job.state === state) { clearTimeout(job.timer); pending.delete(id) }
    }
    listen('destroyed', dispose)
    return dispose
  }

  const owner = event => {
    const window = getWindow()
    return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  }
  const action = (event, message) => {
    if (!owner(event) || !message || typeof message !== 'object') return
    if (message.op === 'manage') { manage(); return }
    if (message.op === 'manager-setting') {
      if (settings({ op: 'builtin-manager-set', enabled: message.enabled }).status !== 'available') { error('设置未保存。'); return }
      manage(); return
    }
    if (message.op === 'agent-setting') {
      if (settings({ op: 'builtin-set', enabled: message.enabled }).status !== 'available') { error('设置未保存，请检查磁盘权限。'); return }
      manage(); return
    }
    if (message.op === 'revoke-agent') { agent.revoke(); manage(); return }
    if (message.op === 'delete') {
      agent.revoke()
      if (typeof message.id === 'string') { const r = vault.remove(message.id); if (!r.ok) { error('删除失败，密码库未修改。'); return } }
      manage(); return
    }
    if (message.op === 'allow-site') { if (typeof message.origin === 'string') vault.removeNever(message.origin); manage(); return }
    if (!managerEnabled) return
    const state = states.get(message.guestId)
    if (!state || state.guest.isDestroyed()) return
    if (message.op === 'picker-focus') { clearTimeout(state.blurTimer); state.blurTimer = null; return }
    if (message.op === 'dismiss') { state.offer = null; hide(state); return }
    if (message.op === 'save' || message.op === 'never') {
      const offer = state.offer
      if (!offer || offer.token !== message.token || offer.epoch !== state.epoch) return
      const result = message.op === 'never' ? vault.addNever(offer.origin)
        : vault.add({ origin: offer.origin, username: offer.username, password: offer.password })
      if (result.ok) { state.offer = null; hide(state) } else error('保存失败：请检查操作系统密钥环和磁盘权限。')
      return
    }
    if (message.op !== 'fill') return
    const focus = state.focus, frame = state.guest.mainFrame
    if (!focus || focus.fieldToken !== message.fieldToken || focus.epoch !== state.epoch || focus.frame !== frame
      || frame.detached || toBrowserPasswordOrigin(frame.origin) !== focus.origin || Date.now() - focus.shownAt < 500) return
    const matches = vault.findForOrigin(focus.origin)
    const entry = matches.ok && matches.value.exact.find(entry => entry.id === message.id)
    if (!entry) return
    const secret = vault.getPassword(entry.id)
    if (!secret.ok) { error('系统无法解锁此密码。'); return }
    const requestId = randomUUID()
    const timer = setTimeout(() => { pending.delete(requestId); error('填写超时，请重新选择账号。') }, 3000)
    pending.set(requestId, { state, epoch: state.epoch, entryId: entry.id, timer })
    frame.send(OUT.fill, { requestId, fieldToken: focus.fieldToken, username: entry.username || null, password: secret.value })
    hide(state)
  }
  ipcMain.on(PASSWORD_ACTION, action)
  function manage() {
    const entries = vault.list(), never = vault.listNever()
    if (!entries.ok || !never.ok) { error('系统密码库暂不可用。'); return }
    emit({ kind: 'manage', agentEnabled, managerEnabled, entries: entries.value.map(({ id, origin, username }) => ({ id, origin, username })), never: never.value })
  }
  return { attach, manage, agent, settings, dispose() {
    ipcMain.removeListener(PASSWORD_ACTION, action)
    for (const [channel, listener] of handlers) ipcMain.removeListener(channel, listener)
    for (const state of states.values()) { clearTimeout(state.blurTimer); state.tracker.dispose(); for (const [event, fn] of state.listeners) state.guest.removeListener(event, fn) }
    for (const job of pending.values()) clearTimeout(job.timer)
    states.clear(); pending.clear()
  } }
}
