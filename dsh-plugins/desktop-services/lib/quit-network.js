// After every plugin is disposed, the Host closes its proxy dispatcher and
// waits for it. undici does not cancel a proxy CONNECT that is still in
// progress when its fetch is aborted, so a WeChat long-poll aborted during the
// tunnel handshake keeps close() pending until the Host is force-exited five
// seconds later. Shutdown is the only caller of close(): give it a short grace
// for orderly requests, then destroy what is left.
export const DISPATCHER_CLOSE_GRACE_MS = 300
const GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.2')

export function boundDispatcherClose({ graceMs = DISPATCHER_CLOSE_GRACE_MS, log = () => {} } = {}) {
  const agent = globalThis[GLOBAL_DISPATCHER]
  if (!agent || typeof agent.close !== 'function' || typeof agent.destroy !== 'function') return false
  const close = agent.close.bind(agent)
  agent.close = callback => {
    if (typeof callback === 'function') return close(callback)
    let timer
    const closed = close().then(() => true)
    const grace = new Promise(resolve => { timer = setTimeout(resolve, graceMs, false) })
    return Promise.race([closed, grace]).then(done => {
      clearTimeout(timer)
      if (done) return
      log()
      return agent.destroy()
    })
  }
  return true
}
