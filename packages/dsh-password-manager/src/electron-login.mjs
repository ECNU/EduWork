import { randomUUID } from 'node:crypto'
import { loginLoadStatus } from './login-errors.mjs'

function sameOrigin(url, origin) {
  try { const parsed = new URL(url); return parsed.origin === origin && parsed.protocol === 'https:' && !parsed.username && !parsed.password }
  catch { return false }
}

// Electron is injected by the native shell, keeping it out of the Host bundle.
export function createElectronLogin({ app, BrowserWindow, session }, { timeoutMs = 180000 } = {}) {
  return {
    async open(target, destination, signal, { automatic = false } = {}) {
      if (process.platform === 'darwin') throw Error('unsupported-platform')
      if (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe')) throw Error('debugging-enabled')
      if (signal?.aborted) throw Error('cancelled')
      const isolated = session.fromPartition(`eduwork-credential-${randomUUID()}`, { cache: false })
      isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      isolated.setPermissionCheckHandler(() => false)
      // All requests, including forms, fetches, frames and redirects, remain on the approved origin.
      isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !sameOrigin(details.url, target.origin) }))
      isolated.on('will-download', event => event.preventDefault())
      let completed = false, confirmed = false, closed = false, filled = false, resolveDone, rejectDone
      const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
      // A window may be closed while the provider is still retrieving the account.
      void done.catch(() => {})
      const window = new BrowserWindow({ width: 960, height: 720, show: !automatic,
        title: `EduWork 登录 · ${target.origin}`, webPreferences: {
          session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
          devTools: false, webviewTag: false, safeDialogs: true, navigateOnDragDrop: false,
        } })
      const fail = reason => {
        if (!completed) { completed = true; rejectDone(Error(reason)) }
        if (!window.isDestroyed()) window.destroy()
      }
      const timer = setTimeout(() => fail('login-timeout'), timeoutMs)
      const abort = () => fail('cancelled')
      signal?.addEventListener('abort', abort, { once: true })
      window.setMenu(null)
      window.on('page-title-updated', event => event.preventDefault())
      window.on('closed', () => { if (!completed) { completed = true; rejectDone(Error('login-window-closed')) } })
      const wc = window.webContents
      let submitted = false, navigated = false, secretForTransfer = ''
      wc.on('did-navigate', () => { if (submitted) navigated = true })
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('will-navigate', (event, url) => { if (!sameOrigin(url, target.origin)) event.preventDefault() })
      wc.on('will-redirect', (event, url) => { if (!sameOrigin(url, target.origin)) event.preventDefault() })
      wc.on('login', event => event.preventDefault())
      wc.on('select-client-certificate', (event, _url, _certificates, callback) => { event.preventDefault(); callback() })
      const cleanup = async () => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (!completed) fail('cancelled')
        if (!window.isDestroyed()) window.destroy()
        await isolated.closeAllConnections()
        await isolated.clearStorageData()
        await isolated.clearCache()
      }
      try { await wc.loadURL(target.loginURL); if (signal?.aborted || window.isDestroyed()) throw Error('cancelled') }
      catch (error) { await cleanup(); throw Error(signal?.aborted ? 'cancelled' : loginLoadStatus(error)) }
      return {
        async fill({ username, password }) {
          if (completed || wc.isDestroyed() || !sameOrigin(wc.getURL(), target.origin)) throw Error('origin-changed')
          // Execute only fixed code in an isolated world; credentials never become a tool argument.
          const result = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: `(() => {
            if (location.origin !== ${JSON.stringify(target.origin)}) return false;
            const visible = e => !e.disabled && !e.readOnly && e.getClientRects().length > 0;
            const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
            if (passwords.length !== 1) return false;
            const passwordField = passwords[0];
            const form = passwordField.form;
            if (!form || new URL(form.action || location.href).origin !== location.origin) return false;
            const names = [...form.querySelectorAll('input[autocomplete="username"],input[type="email"],input[type="text"],input:not([type])')].filter(visible);
            if (names.length !== 1) return false;
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            set.call(names[0], ${JSON.stringify(username)});
            names[0].dispatchEvent(new Event('input', {bubbles:true}));
            names[0].dispatchEvent(new Event('change', {bubbles:true}));
            set.call(passwordField, ${JSON.stringify(password)});
            passwordField.dispatchEvent(new Event('input', {bubbles:true}));
            passwordField.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
          })()` }])
          if (result !== true) throw Error('unsupported-login-page')
          filled = true
          secretForTransfer = password
        },
        async submit() {
          if (!automatic || !filled || completed || wc.isDestroyed()) throw Error('unsupported-login-page')
          submitted = true
          // No agent script runs in this session. Accept only a POST form on the
          // approved origin; GET would put credentials into URLs and history.
          const accepted = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: `(() => {
            const fields = [...document.querySelectorAll('input[type="password"]')].filter(e => !e.disabled && !e.readOnly && e.getClientRects().length);
            if (fields.length !== 1) return false;
            const form = fields[0].form;
            if (!form || form.method.toLowerCase() !== 'post' || new URL(form.action || location.href).origin !== location.origin) return false;
            form.requestSubmit(); return true;
          })()` }]).catch(() => false)
          if (!accepted && !navigated) throw Error('unsupported-login-page')
          // Conservative first slice: full-document same-origin login, with
          // cookies and no remaining password field. SPA/MFA needs user input.
          const deadline = Date.now() + Math.min(timeoutMs, 15000)
          while (Date.now() < deadline) {
            if (signal?.aborted || completed || wc.isDestroyed()) throw Error('cancelled')
            if (navigated && !wc.isLoading()) {
              if (!sameOrigin(wc.getURL(), target.origin)) throw Error('origin-changed')
              const hasPassword = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: '!!document.querySelector("input[type=password]")' }])
              const cookies = await isolated.cookies.get({ url: target.origin })
              if (!hasPassword && cookies.length) {
                confirmed = true; completed = true; resolveDone(); return
              }
              throw Error('login-needs-user')
            }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          throw Error('login-needs-user')
        },
        confirm: () => done,
        cancel: () => fail('cancelled'),
        async transfer() {
          if (!confirmed || signal?.aborted || wc.isDestroyed() || !sameOrigin(wc.getURL(), target.origin)) throw Error('cancelled')
          const cookies = await isolated.cookies.get({ url: target.origin })
          const hostname = new URL(target.origin).hostname
          const scoped = cookies.filter(cookie => cookie.domain.replace(/^\./, '') === hostname && !cookie.partitionKey)
          // Never transfer a site's literal password echo into the Agent page.
          // Server-side auth tokens are trusted session state, not tool output.
          if (secretForTransfer && scoped.some(cookie => [cookie.name, cookie.value, cookie.path].some(value => value?.includes(secretForTransfer)))) throw Error('unsafe-session-state')
          if (signal?.aborted || wc.isDestroyed() || !sameOrigin(wc.getURL(), target.origin)) throw Error('cancelled')
          // Close the credential document before handing authenticated state back to the sidebar.
          window.destroy()
          await destination.acceptCookies(target.origin, scoped)
        },
        close: cleanup,
      }
    },
  }
}
