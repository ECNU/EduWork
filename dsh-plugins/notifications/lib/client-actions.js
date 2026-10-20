/** Client-side destinations are supplied by the owning plugin, never by the
 * desktop shell. A missing/disposed handler is an explicit failed navigation. */
export class NotificationActions {
  handlers = new Map()
  register(source, handler, visible = () => null) {
    if (this.handlers.has(source) || typeof handler !== 'function') throw Error('Invalid or duplicate notification action handler')
    const entry = { handler, visible, controller: new AbortController() }
    this.handlers.set(source, entry)
    return () => { entry.controller.abort(); if (this.handlers.get(source) === entry) this.handlers.delete(source) }
  }
  visible() {
    return [...this.handlers].flatMap(([source, entry]) => {
      let value
      try { value = entry.visible() } catch { return [] }
      return value ? [{ source, scope: value.scope ?? 'default', target: value.target }] : []
    })
  }
  async dispatch(action) {
    const entry = this.handlers.get(action.source)
    if (!entry) throw Error('Notification source UI is unavailable')
    const result = await entry.handler({ ...action, signal: entry.controller.signal })
    if (this.handlers.get(action.source) !== entry || result === false) throw Error('Notification source UI was disposed')
  }
  close() { for (const entry of this.handlers.values()) entry.controller.abort(); this.handlers.clear() }
}
