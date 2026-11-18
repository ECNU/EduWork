import assert from 'node:assert/strict'
import test from 'node:test'
import { accountScope, createMailReminders, reminderContent } from '../src/host/notify.js'

const settings = (overrides = {}) => ({
  readEnabled: true,
  notifyEnabled: true,
  notifyIntervalSeconds: 120,
  notifyExcerptChars: 160,
  inboxFolder: 'INBOX',
  email: 'someone@example.edu',
  username: 'someone@example.edu',
  imapHost: 'mail.example.edu',
  ...overrides,
})

function harness({ mail: mailOverrides = {}, publish, ...overrides } = {}) {
  const published = []
  const disposed = []
  const sessions = []
  const logs = []
  const scopes = []
  let uidValidity = '7'
  let uidNext = 10
  const arrivals = []
  const mail = {
    openSession: async () => { const session = { closed: false }; sessions.push(session); return session },
    closeSession: async (session) => { if (session) session.closed = true },
    probeFolder: async () => ({ uidValidity, uidNext, messages: uidNext - 1 }),
    fetchArrivals: async (_client, _folder, { afterUid, limit }) => ({
      uidValidity,
      messages: arrivals.filter(message => message.uid > afterUid).slice(0, limit),
    }),
    readExcerpt: async (_client, _folder, uid) => ({ text: `摘录 ${uid}`, truncated: false }),
    ...mailOverrides,
  }
  const reminders = createMailReminders({
    getSettings: overrides.getSettings ?? (() => settings(overrides.settings)),
    getPassword: overrides.getPassword ?? (async () => 'secret'),
    mail,
    register: (definition) => {
      scopes.push(definition.scope)
      const index = published.push([]) - 1
      return {
        publish: async (value) => {
          if (publish !== undefined) return publish(value)
          published[index].push(value)
          return { status: 'accepted' }
        },
        dispose: () => disposed.push(scopes.at(-1)),
      }
    },
    log: { info: message => logs.push(message), warn: message => logs.push(message) },
    timers: overrides.timers ?? { setTimeout: () => ({ unref() {} }), clearTimeout: () => {} },
  })
  reminders.start()
  return {
    reminders, published, disposed, sessions, logs, scopes, arrivals,
    setProbe: (validity, next) => { uidValidity = validity; uidNext = next },
  }
}

test('the first probe only records the position, so a restart does not replay the inbox', async () => {
  const test1 = harness()
  assert.equal(await test1.reminders.pollOnce(), 'baseline')
  assert.equal(test1.published[0].length, 0)
  test1.arrivals.push({ uid: 11, subject: '新邮件', from: [{ address: 'sender@example.edu' }] })
  test1.setProbe('7', 12)
  assert.equal(await test1.reminders.pollOnce(), 'published')
  assert.equal(test1.published[0].length, 1)
})

test('a new message becomes a reminder with sender, subject and a bounded excerpt', async () => {
  const test1 = harness()
  await test1.reminders.pollOnce()
  test1.arrivals.push({ uid: 10, subject: '关于 2026 年秋季学期课程安排调整的重要通知', from: [{ name: '教务', address: 'sender@example.edu' }] })
  test1.setProbe('7', 11)
  assert.equal(await test1.reminders.pollOnce(), 'published')
  const [notice] = test1.published[0]
  assert.equal(notice.id, '7:10')
  assert.equal(notice.event, 'new-mail')
  assert.equal(notice.title, '关于 2026 年秋季学期课程安排调整的重要通知')
  assert.equal(notice.preview, '教务 · 摘录 10')
  assert.deepEqual(notice.target, { folder: 'INBOX', uid: 10 })
  assert.ok(JSON.stringify(notice.target).length < 4096)
  assert.equal(notice.action, 'open')
  // The watermark advanced, so the same message is never published twice.
  assert.deepEqual(await test1.reminders.pollOnce(), 'idle')
})

test('the notification source is registered once per account and disposed on change', async () => {
  let current = settings()
  const test1 = harness({ getSettings: () => current })
  await test1.reminders.pollOnce()
  assert.deepEqual(test1.scopes, [accountScope(current)])
  current = settings({ imapHost: 'mail.other.edu', username: 'other@example.org' })
  await test1.reminders.pollOnce()
  assert.deepEqual(test1.disposed, [accountScope(settings())])
  assert.deepEqual(test1.scopes, [accountScope(settings()), accountScope(current)])
  assert.deepEqual(test1.scopes[1], 'mail.other.edu:other@example.org')
})

test('an account switch keeps its own watermark instead of inheriting the old one', async () => {
  let current = settings()
  const test1 = harness({ getSettings: () => current })
  test1.arrivals.push({ uid: 10, subject: '给旧账号的邮件', from: [] })
  await test1.reminders.pollOnce()
  test1.setProbe('7', 11)
  await test1.reminders.pollOnce()
  assert.equal(test1.published[0].length, 1)
  // The new account starts at its own position: no backlog, no reuse of account A's marks.
  current = settings({ imapHost: 'mail.other.edu', username: 'other@example.org' })
  assert.equal(await test1.reminders.pollOnce(), 'baseline')
  assert.equal(test1.published[1].length, 0)
})

test('a folder switch is tracked separately', async () => {
  let current = settings()
  const test1 = harness({ getSettings: () => current })
  await test1.reminders.pollOnce()
  current = settings({ inboxFolder: 'Archive' })
  assert.equal(await test1.reminders.pollOnce(), 'baseline')
  const marks = test1.reminders.state.marks
  assert.equal(marks.size, 2)
})

test('a UIDVALIDITY change re-baselines without notifying renumbered mail', async () => {
  const test1 = harness()
  await test1.reminders.pollOnce()
  test1.arrivals.push({ uid: 10, subject: 'renumbered', from: [] })
  test1.setProbe('8', 11)
  assert.equal(await test1.reminders.pollOnce(), 'renumbered')
  assert.equal(test1.published[0].length, 0)
  assert.ok(test1.logs.some(message => /UIDVALIDITY/.test(message)))
  assert.equal(await test1.reminders.pollOnce(), 'idle')
})

test('a body that cannot be read still yields a reminder for the message', async () => {
  const test1 = harness({ mail: { readExcerpt: async () => { throw new Error('download failed') } } })
  await test1.reminders.pollOnce()
  test1.arrivals.push({ uid: 10, subject: '只有主题', from: [{ address: 'a@example.edu' }] })
  test1.setProbe('7', 11)
  await test1.reminders.pollOnce()
  assert.equal(test1.published[0].length, 1)
  assert.equal(test1.published[0][0].preview, 'a@example.edu')
  // The watermark still advanced: a failed read must not become a replay storm.
  test1.arrivals.length = 0
  assert.equal(await test1.reminders.pollOnce(), 'idle')
})

test('a failed publish is logged once and does not replay the message', async () => {
  const test1 = harness({ publish: async () => { throw new Error('registry closed') } })
  await test1.reminders.pollOnce()
  test1.arrivals.push({ uid: 10, subject: 'x', from: [] })
  test1.setProbe('7', 11)
  await test1.reminders.pollOnce()
  assert.ok(test1.logs.some(message => /could not be published/.test(message)))
  assert.equal(await test1.reminders.pollOnce(), 'idle')
})

test('turning reminders off releases the connection and the source', async () => {
  let current = settings()
  const test1 = harness({ getSettings: () => current })
  await test1.reminders.pollOnce()
  assert.equal(test1.reminders.state.session, true)
  current = settings({ notifyEnabled: false })
  assert.equal(await test1.reminders.pollOnce(), 'disabled')
  assert.equal(test1.reminders.state.session, false)
  assert.equal(test1.reminders.state.source, null)
  assert.equal(test1.sessions[0].closed, true)
})

test('reading the mailbox stays optional: no reading, no polling', async () => {
  const test1 = harness({ settings: { readEnabled: false } })
  assert.equal(await test1.reminders.pollOnce(), 'disabled')
  assert.equal(test1.sessions.length, 0)
})

test('stopping the poller closes the session', async () => {
  const test1 = harness()
  test1.reminders.start()
  await test1.reminders.pollOnce()
  await test1.reminders.stop()
  assert.equal(test1.sessions.at(-1).closed, true)
  assert.equal(test1.reminders.state.source, null)
})

test('reminder text stays inside the protocol limits', () => {
  const content = reminderContent(
    { subject: `主题${'很'.repeat(400)}`, from: [{ name: '发件人'.repeat(60) }] },
    '摘'.repeat(400),
  )
  assert.ok([...content.title].length <= 120)
  assert.ok([...content.preview].length <= 400)
  assert.equal(reminderContent({ subject: '', from: [] }, '').title, '（无主题）')
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('disabled reminders only check local settings until the user enables them', async () => {
  let current = settings({ notifyEnabled: false }), scheduled = []
  const fixture = harness({ getSettings: () => current, timers: {
    setTimeout: callback => { scheduled.push(callback); return { unref() {} } }, clearTimeout() {},
  } })
  await scheduled.shift()()
  await settle()
  assert.equal(fixture.sessions.length, 0)
  current = settings()
  await scheduled.shift()()
  await settle()
  assert.equal(fixture.sessions.length, 1)
  await fixture.reminders.stop()
})

for (const action of ['stop', 'disable', 'disable-reading']) {
  test(`${action} closes a late connection without probing or reviving the watermark`, async () => {
    const connected = deferred(), entered = deferred(), client = { closed: false }
    let current = settings(), probes = 0, signal
    const fixture = harness({ getSettings: () => current, mail: {
      openSession: async (_settings, _password, cancellation) => { signal = cancellation; entered.resolve(); return connected.promise },
      probeFolder: async () => { probes++; return { uidValidity: '7', uidNext: 10 } },
    } })
    const polling = fixture.reminders.pollOnce()
    await entered.promise
    if (action === 'disable') current = settings({ notifyEnabled: false })
    if (action === 'disable-reading') current = settings({ readEnabled: false })
    const closing = action === 'stop' ? fixture.reminders.stop() : fixture.reminders.refresh()
    connected.resolve(client)
    await Promise.all([polling, closing])
    assert.equal(signal?.aborted, true)
    assert.equal(client.closed, true)
    assert.equal(probes, 0)
    assert.equal(fixture.reminders.state.session, false)
    assert.equal(fixture.reminders.state.source, null)
    assert.equal(fixture.reminders.state.marks.size, 0)
    assert.equal(fixture.published.flat().length, 0)
  })
}

test('stopping during credential resolution never starts a connection afterwards', async () => {
  const credential = deferred(), entered = deferred()
  const fixture = harness({ getPassword: () => { entered.resolve(); return credential.promise } })
  const polling = fixture.reminders.pollOnce()
  await entered.promise
  const closing = fixture.reminders.stop()
  credential.resolve('synthetic-password')
  await Promise.all([polling, closing])
  assert.equal(fixture.sessions.length, 0)
  assert.equal(fixture.reminders.state.source, null)
})

test('a probe completed after stop cannot recreate the mailbox watermark', async () => {
  const probe = deferred(), entered = deferred()
  const fixture = harness({ mail: { probeFolder: () => { entered.resolve(); return probe.promise } } })
  const polling = fixture.reminders.pollOnce()
  await entered.promise
  await fixture.reminders.stop()
  probe.resolve({ uidValidity: '7', uidNext: 10 })
  await polling
  assert.equal(fixture.reminders.state.marks.size, 0)
  assert.equal(fixture.sessions[0].closed, true)
})

test('disabling reminders during an excerpt read prevents fallback or late notification', async () => {
  const excerpt = deferred(), entered = deferred()
  let current = settings()
  const fixture = harness({ getSettings: () => current, mail: {
    readExcerpt: (_client, _folder, _uid, { signal }) => { entered.resolve(signal); return excerpt.promise },
  } })
  await fixture.reminders.pollOnce()
  fixture.arrivals.push({ uid: 10, subject: 'Synthetic mail', from: [] })
  fixture.setProbe('7', 11)
  const polling = fixture.reminders.pollOnce()
  const signal = await entered.promise
  current = settings({ notifyEnabled: false })
  await fixture.reminders.refresh()
  excerpt.reject(new Error('stream closed'))
  await polling
  assert.equal(signal?.aborted, true)
  assert.equal(fixture.published.flat().length, 0)
  assert.equal(fixture.reminders.state.marks.size, 0)
})

test('a late old-account connection cannot replace or close the new account session', async () => {
  const oldConnection = deferred(), entered = deferred()
  const oldClient = { closed: false }, newClient = { closed: false }
  let current = settings()
  const probed = []
  const fixture = harness({ getSettings: () => current, mail: {
    openSession: async (value) => {
      if (value.imapHost === 'mail.example.edu') { entered.resolve(); return oldConnection.promise }
      return newClient
    },
    probeFolder: async client => { probed.push(client); return { uidValidity: '7', uidNext: 10 } },
  } })
  const oldPoll = fixture.reminders.pollOnce()
  await entered.promise
  current = settings({ imapHost: 'mail.other.edu', username: 'other@example.edu' })
  const refreshing = fixture.reminders.refresh()
  await fixture.reminders.pollOnce()
  oldConnection.resolve(oldClient)
  await Promise.all([oldPoll, refreshing])
  assert.equal(oldClient.closed, true)
  assert.equal(newClient.closed, false)
  assert.deepEqual(probed, [newClient])
  assert.equal(fixture.reminders.state.source, accountScope(current))
  await fixture.reminders.stop()
})

test('overlapping polls share one connection and one mailbox query', async () => {
  const connected = deferred(), entered = deferred(), client = { closed: false }
  let opens = 0, probes = 0
  const fixture = harness({ mail: {
    openSession: async () => { opens++; entered.resolve(); return connected.promise },
    probeFolder: async () => { probes++; return { uidValidity: '7', uidNext: 10 } },
  } })
  const first = fixture.reminders.pollOnce()
  await entered.promise
  const second = fixture.reminders.pollOnce()
  await settle()
  connected.resolve(client)
  await Promise.all([first, second])
  assert.equal(opens, 1)
  assert.equal(probes, 1)
  await fixture.reminders.stop()
})
