/** One account snapshot shared by onboarding, settings and sidebar consumers. */
export function createAccountState(base, { connected = async (_profileID) => {} } = {}) {
  const values = new Map(), versions = new Map(), epochs = new Map(), reads = new Map(), listeners = new Set(), logins = new Map()
  let disposed = false
  const revision = id => versions.get(id) ?? 0
  const invalidate = id => { versions.set(id, revision(id) + 1) }
  const epoch = id => epochs.get(id) ?? 0
  const mutate = id => { invalidate(id); epochs.set(id, epoch(id) + 1); return epoch(id) }
  const publish = status => {
    if (disposed || !status?.profileID) return status
    invalidate(status.profileID)
    const previous = values.get(status.profileID)
    if (JSON.stringify(previous) === JSON.stringify(status)) return previous
    values.set(status.profileID, status)
    for (const listener of [...listeners]) listener(status.profileID)
    return status
  }
  const status = id => {
    const version = revision(id), pending = reads.get(id)
    if (pending?.version === version) return pending.promise
    const promise = base.status(id).then(value => {
      if (revision(id) === version) publish(value)
      return values.get(id) ?? value
    }).finally(() => { if (reads.get(id)?.promise === promise) reads.delete(id) })
    reads.set(id, { version, promise })
    return promise
  }
  const activate = async value => {
    if (value?.state === 'connected' && value.credentialReady) await connected(value.profileID)
  }
  const service = {
    ...base, status,
    accountSnapshot: id => values.get(id) ?? null,
    subscribeAccounts(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async begin(id) {
      const generation = mutate(id), result = await base.begin(id)
      if (epoch(id) !== generation || disposed) return result
      if (result.mode === 'external') logins.set(result.loginID, { id, generation })
      if (result.mode === 'completed') { publish(result.status); await activate(result.status) }
      return result
    },
    async loginStatus(loginID) {
      const next = await base.loginStatus(loginID), flow = logins.get(loginID)
      if (!flow || disposed || epoch(flow.id) !== flow.generation) return next
      if (next.state === 'completed' && next.status) {
        if (!flow.completion) {
          publish(next.status)
          flow.completion = activate(next.status)
        }
        await flow.completion
      }
      return next
    },
    async reconcile(id, options) {
      const generation = mutate(id), result = await base.reconcile(id, options)
      if (epoch(id) === generation && !disposed) {
        publish(result)
        if (options?.allowProvision === true) await activate(result)
      }
      return result
    },
    async logout(id) {
      const generation = mutate(id), result = await base.logout(id)
      if (epoch(id) === generation) publish(result)
      return result
    },
    async refreshAccounts(ids) {
      for (const id of ids) invalidate(id)
      await Promise.all(ids.map(id => status(id).catch(() => {})))
    },
  }
  return { service, dispose() { disposed = true; listeners.clear(); logins.clear(); reads.clear() } }
}

/** DSH 0.1.5 uses the current Session's ModelDirectory, not a global UI field. */
export async function selectConnectedModel(ctx, service, profileID, onlyIfMissing = false) {
  const { selection, changed } = await service.selectEnterpriseModel(profileID, { onlyIfMissing })
  if (!changed || !selection) return
  const sessions = ctx.get?.('sessions')
  const current = sessions?.list?.getSnapshot().current
  if (!current || sessions.subagentAddress(current) !== undefined) return
  const directories = ctx.get?.('modelDirectories')
  if (!directories) throw new Error('已连接企业模型，但当前对话的模型选择器尚未准备好。请在模型菜单中选择。')
  const directory = directories.directoryFor(current)
  if (onlyIfMissing) {
    const state = await directory.load()
    if (state.current && state.routable !== false) return
  }
  await directory.select(selection)
}
