// Trusted application preload only. Website processes never receive this UI or its IPC.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { ipcRenderer, webFrame } = require('electron')
  let panel, current
  const close = () => { panel?.remove(); panel = null; current = null }
  const send = value => ipcRenderer.send('eduwork:browser-passwords:action', value)
  const node = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n }
  const button = (text, action, primary = false) => {
    const n = node('button', text)
    n.type = 'button'
    n.style.cssText = `font:inherit;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);padding:6px 12px;cursor:pointer;background:${primary ? 'var(--dsw-alias-brand-primary)' : 'transparent'};color:${primary ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-primary)'};text-align:left`
    n.addEventListener('click', event => { if (event.isTrusted) action() })
    return n
  }
  ipcRenderer.on('eduwork:browser-passwords:ui', async (_event, value) => {
    if (value.kind === 'hide' || value.kind === 'filled') {
      if (current?.guestId === value.guestId) close()
      return
    }
    close(); current = value
    panel = node('section'); panel.id = 'eduwork-browser-passwords'
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '浏览器密码')
    panel.addEventListener('focusin', event => {
      if (event.isTrusted && value.kind === 'choose') send({ op: 'picker-focus', guestId: value.guestId })
    })
    panel.style.cssText = 'position:fixed;z-index:2147483647;right:24px;top:100px;width:320px;max-height:65vh;overflow:auto;background:var(--dsw-alias-bg-layer-2,white);color:var(--dsw-alias-label-primary,#172033);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xl,12px);padding:16px;box-shadow:var(--dsw-elevation-prominent);font:14px/22px system-ui;box-sizing:border-box'
    const title = node('div'); title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:600'
    title.append(node('span', value.kind === 'choose' ? '填写已保存的账号' : value.kind === 'save' ? '保存密码？' : value.kind === 'update' ? '更新已保存的密码？' : value.kind === 'manage' ? '浏览器密码' : '密码管理'))
    title.append(button('×', () => { if (value.guestId) send({ op: 'dismiss', guestId: value.guestId }); close() }))
    panel.append(title)
    if (value.kind === 'choose') {
      panel.classList.add('password-picker')
      const style = node('style'); style.textContent = `
        #eduwork-browser-passwords.password-picker{padding:6px;width:300px;max-width:calc(100vw - 16px);border-radius:12px;font-family:inherit;box-shadow:0 8px 32px #00000018,0 2px 8px #0000000a}
        #eduwork-browser-passwords.password-picker>div:first-child{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);margin:0;padding:4px 8px}
        #eduwork-browser-passwords.password-picker button{border:0;background:transparent;border-radius:8px;color:inherit;font:inherit;cursor:pointer}
        #eduwork-browser-passwords.password-picker button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f1f3f5)}
        #eduwork-browser-passwords.password-picker button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:-2px}
        #eduwork-browser-passwords.password-picker .password-account{display:flex;align-items:center;gap:10px;width:100%;margin:2px 0;padding:10px;text-align:left;min-height:52px}
        #eduwork-browser-passwords.password-picker .password-account-icon{display:grid;place-items:center;flex:0 0 30px;height:30px;border-radius:50%;background:var(--dsw-alias-bg-module-platform,#f1f3f5);color:var(--dsw-alias-label-secondary);font-size:14px}
        #eduwork-browser-passwords.password-picker .password-account-copy{min-width:0;display:flex;flex-direction:column;gap:2px}
        #eduwork-browser-passwords.password-picker .password-account-name{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #eduwork-browser-passwords.password-picker .password-account-site{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #eduwork-browser-passwords.password-picker .password-picker-footer{border-top:.5px solid var(--dsw-alias-border-l2,#e5e7eb);margin-top:4px;padding-top:4px}
        #eduwork-browser-passwords.password-picker .password-picker-footer button{width:100%;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      `; panel.append(style)
    }
    if (value.origin && value.kind !== 'choose') { const origin = node('div', value.origin); origin.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin-bottom:12px'; panel.append(origin) }
    const row = () => { const n = node('div'); n.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap'; panel.append(n); return n }
    if (value.kind === 'choose') {
      for (const entry of value.entries) {
        const b = button(entry.username || '此网站账号', () => send({ op: 'fill', guestId: value.guestId, fieldToken: value.fieldToken, id: entry.id }))
        b.className = 'password-account'; b.textContent = ''; b.style.cssText = ''
        const icon = node('span', (entry.username || '账').slice(0,1).toUpperCase()); icon.className = 'password-account-icon'; icon.setAttribute('aria-hidden','true')
        const copy = node('span'); copy.className = 'password-account-copy'
        const name = node('span', entry.username || '此网站账号'); name.className = 'password-account-name'
        let site = value.origin; try { site = new URL(value.origin).host } catch {}
        const subtitle = node('span', site); subtitle.className = 'password-account-site'
        copy.append(name, subtitle); b.append(icon, copy); b.setAttribute('aria-label', entry.username || '此网站账号'); b.disabled = true
        setTimeout(() => { b.disabled = false }, 500)
        panel.append(b)
      }
      const footer = node('footer'); footer.className = 'password-picker-footer'
      footer.append(button('管理已保存密码', () => send({ op: 'manage' }))); panel.append(footer)
      // Anchor to the actual visible webview, accounting for its CSS scale/zoom.
      try {
          // Electron exposes webview methods in the application's main world.
          // Return geometry only; no website content or credentials cross this call.
          const bounds = await webFrame.executeJavaScript(`(()=>{for(const v of document.querySelectorAll('webview')){try{if(v.getWebContentsId()===${JSON.stringify(value.guestId)}){const r=v.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}}catch{}}return null})()`)
          if (current !== value) return
          if (bounds) {
          const scale = bounds.width / value.viewportWidth
          if (!bounds.width || !bounds.height) { close(); return }
          panel.style.right = 'auto'
          panel.style.left = Math.max(8, Math.min(innerWidth - 308, bounds.x + value.rect.x * scale)) + 'px'
          panel.style.top = Math.max(8, Math.min(innerHeight - 200, bounds.y + (value.rect.y + value.rect.height) * scale + 6)) + 'px'
          }
        } catch { /* Guest may have navigated; main revalidates on selection. */ }
    } else if (value.kind === 'save' || value.kind === 'update') {
      panel.append(node('div', value.username || '此网站账号'))
      panel.append(node('div', '密码由操作系统加密保存在本机。'))
      const actions = row(), request = op => send({ op, guestId: value.guestId, token: value.token })
      actions.append(button(value.kind === 'update' ? '更新密码' : '保存密码', () => request('save'), true), button('暂不', () => { request('dismiss'); close() }), button('此网站不保存', () => request('never')))
    } else if (value.kind === 'manage') {
      panel.append(node('p', '跟随当前操作系统用户解锁。网站登录后可选择保存密码。'))
      const general = node('label'), mainToggle = node('input')
      mainToggle.type = 'checkbox'; mainToggle.checked = value.managerEnabled !== false
      mainToggle.addEventListener('change', event => { if (event.isTrusted) send({ op: 'manager-setting', enabled: mainToggle.checked }) })
      general.append(mainToggle, document.createTextNode(' 启用浏览器密码管理')); panel.append(general)
      const setting = node('label'), toggle = node('input')
      toggle.disabled = value.managerEnabled === false; toggle.type = 'checkbox'; toggle.checked = value.agentEnabled === true
      toggle.addEventListener('change', event => { if (event.isTrusted) send({ op: 'agent-setting', enabled: toggle.checked }) })
      setting.append(toggle, document.createTextNode(' 允许 Agent 使用已保存账号')); panel.append(setting)
      panel.append(node('p', '开启后首次登录需选择账号，同一会话可复用授权。登录工具只返回状态。通用浏览器脚本和调试仍可访问普通页面的表单内容。'))
      if (value.agentEnabled) panel.append(button('撤销会话授权', () => send({ op: 'revoke-agent' })))
      if (!value.entries.length) panel.append(node('p', '尚未保存账号。'))
      for (const entry of value.entries) {
        const item = node('div'); item.style.cssText = 'border-top:.5px solid var(--dsw-alias-border-l2);padding:10px 0;overflow-wrap:anywhere'
        item.append(node('div', entry.origin), node('strong', entry.username || '此网站账号'), button('删除', () => send({ op: 'delete', id: entry.id })))
        panel.append(item)
      }
      for (const origin of value.never) { const item = node('div', origin + ' · 不保存'); item.append(button('恢复保存提示', () => send({ op: 'allow-site', origin }))); panel.append(item) }
    } else panel.append(node('p', value.text || '密码库暂不可用。'))
    document.documentElement.append(panel)
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel) { if (current?.guestId) send({ op: 'dismiss', guestId: current.guestId }); close() } }, true)
}
