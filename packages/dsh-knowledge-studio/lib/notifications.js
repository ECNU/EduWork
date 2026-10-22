// Studio owns artifact interpretation and click validation. The notification
// service and desktop shell never read Studio stores or know its navigation.
export class StudioNotifications {
  constructor(service, handle, { now = Date.now } = {}) {
    Object.assign(this, { service, handle, now, startedAt: now(), seen: new Map(), notices: new Map() })
  }
  async refresh() {
    if (this.handle.signal.aborted) return
    const current = new Set(), running = []
    for (const workspace of this.service.ctx.workspaceRegistry.list()) {
      const { artifacts } = await this.service.listArtifacts(workspace.id)
      if (this.handle.signal.aborted) return
      for (const row of artifacts) {
        current.add(row.id)
        if (!row.deletedAt && ['queued', 'running'].includes(row.status)) running.push(row.id)
        const signature = `${row.version}:${row.status}:${row.lifecycle?.state ?? ''}:${!!row.deletedAt}`
        if (this.seen.get(row.id) === signature) continue
        for (const notice of this.notices.get(row.id) ?? []) this.handle.withdraw(notice)
        this.notices.delete(row.id)
        if (!row.deletedAt && row.sessionId && ['completed', 'failed'].includes(row.status) &&
          row.lifecycle?.state !== 'open' && !['aborted', 'interrupted'].includes(row.lifecycle?.reason) &&
          Date.parse(row.updatedAt) >= this.startedAt) {
          const id = `${row.id}:${row.version}:${row.status}`
          await this.handle.publish({ id, event: row.status, title: String(row.title ?? '').replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 120),
            target: { artifactId: row.id, sessionId: row.sessionId } })
          if (this.handle.signal.aborted) return
          this.notices.set(row.id, [id])
        }
        this.seen.set(row.id, signature)
      }
    }
    for (const id of this.seen.keys()) if (!current.has(id)) {
      for (const notice of this.notices.get(id) ?? []) this.handle.withdraw(notice)
      this.notices.delete(id); this.seen.delete(id)
    }
    this.handle.activity(running.slice(0, 200))
  }
}

export function installStudioNotifications(ctx, service) {
  ctx.inject(['notifications'], inner => {
    if (inner.notifications.version !== 1) throw Error('Studio requires notification protocol 1')
    const handle = inner.notifications.register(inner, {
      version: 1, source: 'studio', label: 'Studio',
      events: [
        { id: 'completed', label: 'Studio 成果已完成', level: 'success', requiresAction: false, actions: ['open'], legacyPreference: 'studio' },
        { id: 'failed', label: 'Studio 成果生成失败', level: 'error', requiresAction: false, actions: ['open'], legacyPreference: 'failed' },
      ],
      onView: (target, view) => target.artifactId === view.artifactId && target.sessionId === view.sessionId,
      onAction: async ({ target, signal }) => {
        const { artifact } = await service.readArtifact(target.artifactId)
        if (signal.aborted || artifact.deletedAt || artifact.sessionId !== target.sessionId) return false
        return target
      },
    })
    const observer = new StudioNotifications(service, handle)
    let timer, warned = false
    const poll = async () => {
      try { await observer.refresh(); warned = false }
      catch (error) { if (!handle.signal.aborted && !warned) { inner.logger?.warn(`Studio notifications: ${error.message}`); warned = true } }
      if (!handle.signal.aborted) { timer = setTimeout(poll, 3000); timer.unref?.() }
    }
    void poll()
    inner.effect(() => () => { handle.dispose(); clearTimeout(timer) })
  })
}
