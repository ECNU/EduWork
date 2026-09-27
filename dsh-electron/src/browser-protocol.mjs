import { randomUUID } from 'node:crypto'

// CDP surface restricted to windows created by this connection. It never
// connects to Electron's application-wide remote debugging endpoint.
export class BrowserProtocol {
  constructor({ runtime, emit, version, purpose = 'render', mode = 'background' }) {
    Object.assign(this, { runtime, emit, version, purpose, mode })
    this.targets = new Map(); this.sessions = new Map(); this.contexts = new Map(); this.streams = new Map()
    this.prefix = randomUUID(); this.discover = false; this.autoAttach = false
    for (const id of runtime.windows?.keys() ?? []) this.track(id)
  }
  track(id, context) {
    this.targets.set(id, { context })
    const window = this.runtime.get(id)
    window.on('closed', () => {
      for(const [key,stream] of this.streams)if(this.sessions.get(stream.sessionId)?.id===id)this.streams.delete(key)
      this.targets.delete(id)
      for (const [key, session] of this.sessions) if (session.id === id) { this.sessions.delete(key); this.emit({ method: 'Target.detachedFromTarget', params: { sessionId: key, targetId: id } }) }
      this.emit({ method: 'Target.targetDestroyed', params: { targetId: id } })
    })
    window.webContents.on('did-navigate', () => { if (this.targets.has(id)) this.emit({ method: 'Target.targetInfoChanged', params: { targetInfo: this.info(id) } }) })
  }
  info(id) {
    const window = this.runtime.get(id), web = window.webContents
    return { targetId: id, type: 'page', title: web.getTitle(), url: web.getURL(), attached: this.sessions.has(id), canAccessOpener: false,
      browserContextId: this.targets.get(id)?.context ?? this.prefix + '-default' }
  }
  attach(id) {
    if (!this.targets.has(id)) throw Error('Unknown owned target')
    if (this.sessions.has(id)) return id
    const web = this.runtime.get(id).webContents
    web.debugger.attach('1.3')
    this.sessions.set(id, { id, web })
    web.debugger.on('message', (_event, method, params, childSession) => {
      if (method === 'Target.attachedToTarget') this.sessions.set(params.sessionId, { id, web, child: params.sessionId })
      this.emit({ method, params, sessionId: childSession || id })
      if (method === 'Target.detachedFromTarget') this.sessions.delete(params.sessionId)
    })
    this.emit({ method: 'Target.attachedToTarget', params: { sessionId: id, targetInfo: this.info(id), waitingForDebugger: false } })
    return id
  }
  closeTarget(id) {
    if (!this.targets.has(id)) throw Error('Unknown owned target')
    this.runtime.closeTarget(id)
  }
  async command({ method, params = {}, sessionId }) {
    if (sessionId === this.prefix + '-browser') sessionId = undefined
    if (method === 'EduWork.setVisible') {
      const target = sessionId ? this.sessions.get(sessionId)?.id : (params.targetId ?? (this.targets.size === 1 ? this.targets.keys().next().value : undefined))
      if (!this.targets.has(target)) throw Error('Unknown owned target')
      this.runtime.present(target, params.visible === true)
      return {}
    }
    if (method === 'Target.closeTarget') { this.closeTarget(params.targetId); return { success: true } }
    if (method === 'Target.activateTarget') {
      if (!this.targets.has(params.targetId)) throw Error('Unknown owned target')
      if (this.mode === 'visible') this.runtime.get(params.targetId).focus()
      return {}
    }
    if (sessionId) {
      const session = this.sessions.get(sessionId)
      if (!session) throw Error('Unknown owned session')
      if (method === 'Page.printToPDF') {
        const {paperWidth=8.5,paperHeight=11,marginTop=0,marginBottom=0,marginLeft=0,marginRight=0,transferMode,...options}=params
        const data=await session.web.printToPDF({...options,pageSize:{width:paperWidth*25.4,height:paperHeight*25.4},margins:{top:marginTop,bottom:marginBottom,left:marginLeft,right:marginRight}})
        if(transferMode!=='ReturnAsStream')return {data:data.toString('base64')}
        const handle=randomUUID();this.streams.set(handle,{sessionId,data,offset:0});return {stream:handle}
      }
      if (method === 'IO.read' || method === 'IO.close') {
        const stream=this.streams.get(params.handle)
        if(!stream || stream.sessionId!==sessionId)throw Error('Unknown owned stream')
        if(method==='IO.close'){this.streams.delete(params.handle);return {}}
        const offset=params.offset??stream.offset,size=params.size??65536
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(size)||size<1)throw Error('Invalid stream range')
        const end=Math.min(offset+Math.min(size,1048576),stream.data.length)
        stream.offset=end;return {data:stream.data.subarray(offset,end).toString('base64'),base64Encoded:true,eof:end===stream.data.length}
      }
      if (method === 'Target.detachFromTarget') {
        const child = this.sessions.get(params.sessionId)
        if (!child || child.id !== session.id || !child.child) throw Error('Unknown child session')
      } else if (method.startsWith('Target.') && method !== 'Target.setAutoAttach') throw Error('Target operation is not exposed')
      if (!/^(?:Page|Runtime|DOM|DOMSnapshot|CSS|Network|Input|Emulation|Log|Performance|Security|Fetch|Target)\./u.test(method)) throw Error('Protocol domain is not exposed')
      if (method === 'Page.navigate' && !/^https?:\/\//iu.test(params.url) && params.url !== 'about:blank') throw Error('Unsupported navigation')
      return session.web.debugger.sendCommand(method, params, session.child)
    }
    switch (method) {
      case 'Target.attachToBrowserTarget': return { sessionId: this.prefix + '-browser' }
      case 'Browser.getVersion': return { protocolVersion: '1.3', product: 'Chrome/' + this.version, revision: '', userAgent: 'EduWork (Windows) Chromium/' + this.version, jsVersion: '' }
      case 'Target.getTargetInfo': return { targetInfo: params.targetId ? this.info(params.targetId) : { targetId: this.prefix, type: 'browser', title: 'EduWork managed browser', url: '', attached: true, canAccessOpener: false } }
      case 'Browser.setDownloadBehavior': return {} // Downloads remain denied by the owned session.
      case 'Target.getBrowserContexts': return { browserContextIds: [...this.contexts.keys()] }
      case 'Target.createBrowserContext': { const id = randomUUID(); this.contexts.set(id, `eduwork-browser-${this.prefix}-${id}`); return { browserContextId: id } }
      case 'Target.disposeBrowserContext': {
        if (!this.contexts.has(params.browserContextId)) throw Error('Unknown owned context')
        for (const [id, target] of this.targets) if (target.context === params.browserContextId) this.closeTarget(id)
        this.contexts.delete(params.browserContextId); return {}
      }
      case 'Target.setDiscoverTargets': this.discover = params.discover; for (const id of this.targets.keys()) this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.info(id) } }); return {}
      case 'Target.setAutoAttach': this.autoAttach = params.autoAttach; if (this.autoAttach) for (const id of this.targets.keys()) this.attach(id); return {}
      case 'Target.getTargets': return { targetInfos: [...this.targets.keys()].map(id => this.info(id)) }
      case 'Target.attachToTarget': return { sessionId: this.attach(params.targetId) }
      case 'Target.detachFromTarget': {
        if (params.sessionId === this.prefix + '-browser') return {}
        const session = this.sessions.get(params.sessionId)
        if (!session) throw Error('Unknown owned session')
        session.web.debugger.detach(); this.sessions.delete(params.sessionId)
        this.emit({ method: 'Target.detachedFromTarget', params: { sessionId: params.sessionId, targetId: session.id } }); return {}
      }
      case 'Target.createTarget': {
        if (params.url && params.url !== 'about:blank') throw Error('Create an empty page before navigation')
        if (params.browserContextId && !this.contexts.has(params.browserContextId)) throw Error('Unknown owned context')
        const id = await this.runtime.create({ purpose: this.purpose, mode: this.mode, partition: this.contexts.get(params.browserContextId) ?? (this.purpose === 'managed' ? 'persist:eduwork-managed-browser' : `eduwork-render-${this.prefix}`) })
        this.track(id, params.browserContextId)
        if (this.discover) this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.info(id) } })
        if (this.autoAttach) this.attach(id)
        return { targetId: id }
      }
      case 'Browser.close': this.close(); return {}
      default: throw Error('Browser operation is not exposed: ' + method)
    }
  }
  close() { this.runtime.close(); this.contexts.clear(); this.targets.clear(); this.sessions.clear(); this.streams.clear() }
}
