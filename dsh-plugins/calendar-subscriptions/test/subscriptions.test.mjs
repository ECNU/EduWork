// Subscriptions own fetching; the calendar owns events.
//
// These tests drive the subscription service the way the panel and the agent
// will: a feed is added, the calendar shows its events, the feed changes, the
// network fails. What must hold is the seam's contract — a clean read replaces
// the previous snapshot without duplicates, a failed read keeps the last good
// events, and both the feed configuration and its events survive a restart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

// `dsh-plugins/*` ships no node_modules: the Runtime pinned by the assembly
// provides storage and zod, and the calendar this plugin talks to is the
// sibling tree. Without a runtime these tests skip, like the others.
const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined
const siblingCalendar = fileURLToPath(new URL('../../calendar/', import.meta.url))
const load = name => import(pathToFileURL(require.resolve(name)).href)

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@eduwork/dsh-calendar' || specifier.startsWith('@eduwork/dsh-calendar/')) {
        const file = specifier === '@eduwork/dsh-calendar' ? 'lib/index.js' : specifier === '@eduwork/dsh-calendar/ics' ? 'lib/ics.js' : null
        if (!file) return nextResolve(specifier, context)
        return { url: pathToFileURL(join(siblingCalendar, file)).href, shortCircuit: true }
      }
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/') || specifier.startsWith('@earendil-works/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      return nextResolve(specifier, context)
    },
  })
}

let modules
async function loadModules() {
  bindRuntime()
  modules ??= (async () => {
    const [cordis, hub, json, domain, calendar, subscriptions] = await Promise.all([
      load('@deepseek-ai/cordis'),
      load('@deepseek-ai/dsh-storage'),
      load('@deepseek-ai/dsh-storage-json'),
      load('@deepseek-ai/dsh-storage-domain'),
      import('../../calendar/lib/index.js'),
      import('../lib/index.js'),
    ])
    return {
      Context: cordis.Context,
      storageHub: hub,
      storageJson: json,
      storageDomain: domain,
      CalendarService: calendar.CalendarService,
      CalendarSubscriptions: subscriptions.default,
    }
  })()
  return await modules
}

test.after(() => hooks?.deregister())

/** The temporary tree a test owns; removed only after its path was verified. */
async function withRoot(prefix, body) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await body(root)
  } finally {
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith(prefix))
    await rm(target, { recursive: true, force: true })
  }
}

/** Run one body against started calendar and subscription services. */
async function withStack(root, body, options = {}) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService, CalendarSubscriptions } = await loadModules()
  const ctx = new Context()
  await ctx.plugin(storageHub.default ?? storageHub)
  await ctx.plugin(storageJson, { root: join(root, 'storages') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(CalendarService)
  if (options.oidc) { ctx.provide('oidcAccounts'); ctx.set('oidcAccounts', options.oidc) }
  else if (options.oidcFactory) await options.oidcFactory(ctx)
  await ctx.plugin(CalendarSubscriptions, options.config ?? {})
  if (options.academic) {
    const { default: AcademicCalendar } = await import('../../../packages/dsh-academic-calendar/lib/index.js')
    const fiber = await ctx.plugin(AcademicCalendar)
    options.academicLoaded?.(fiber)
    await ctx.academicCalendar.ready
  }
  assert.ok(ctx.calendarSubscriptions, 'the service is reachable as ctx.calendarSubscriptions')
  await ctx.calendarSubscriptions.ready
  try {
    return await body(ctx.calendarSubscriptions, ctx.calendar, ctx)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** A local ICS origin whose body and status a test can change between reads. */
async function withFeedServer(initial, body) {
  let feedBody = initial.body
  let feedStatus = initial.status ?? 200
  let gate
  const server = createServer(async (request, response) => {
    initial.onRequest?.(request)
    await gate
    response.writeHead(feedStatus, { 'content-type': 'text/calendar; charset=utf-8' })
    response.end(feedStatus === 200 ? feedBody : '')
  })
  await new Promise(ready => server.listen(0, '127.0.0.1', ready))
  const url = `http://127.0.0.1:${server.address().port}/holidays.ics`
  try {
    return await body({ url, hold: value => { gate = value }, set: (next, status) => { feedBody = next; feedStatus = status ?? 200 } })
  } finally {
    await new Promise(done => { server.close(done); server.closeAllConnections() })
  }
}

/** Calendar text from lines, the way a file is written. */
const icsText = (...lines) => lines.flat().join('\r\n') + '\r\n'

/** A feed in the chinese-days shape: all-day entries, one with a span. */
const holidayFile = (...vevents) => icsText('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//subscriptions//zh', ...vevents, 'END:VCALENDAR')
const allDay = (uid, title, start, end) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `SUMMARY:${title}`,
  `DTSTART;VALUE=DATE:${start}`,
  ...(end ? [`DTEND;VALUE=DATE:${end}`] : []),
  'END:VEVENT',
]

const feedEvents = calendar => calendar.snapshot().events.filter(event => event.source?.startsWith('sync:'))

test('a thirty-day refresh waits through bounded timer chunks and can be cancelled', { skip: !runtime }, async t => {
  await withRoot('subs-long-interval-', async root => withFeedServer({ body: holidayFile() }, async ({ url }) => {
    await withStack(root, async subs => {
      const { feed } = await subs.addFeed({ url, intervalHours: 720 })
      const now = Date.now()
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now })
      try {
        let calls = 0
        const original = subs.refresh
        subs.refresh = async () => { calls++; await subs.remember(feed.id, { lastSuccessAt: new Date().toISOString() }) }
        subs.schedule(subs.feedConfigs.get(feed.id), 720 * 3600000)
        t.mock.timers.tick(2 ** 31 - 1)
        assert.equal(calls, 0, 'first timer chunk must not fetch early')
        t.mock.timers.tick(720 * 3600000 - (2 ** 31 - 1))
        assert.equal(calls, 1)
        await Promise.resolve(); await Promise.resolve()
        subs.schedule(subs.feedConfigs.get(feed.id), 720 * 3600000)
        await subs.updateFeed(feed.id, { enabled: false })
        t.mock.timers.tick(31 * 86400000)
        assert.equal(calls, 1, 'disabling cancels a chunked wait')
        subs.refresh = original
      } finally { t.mock.timers.reset() }
    })
  }))
})

const educationCalendar = revision => ({ schemaVersion: 2, revision, academicYear: '2026-2027', terms: [{ id: 'autumn', name: '秋季', firstDay: '2026-09-14', lastDay: '2027-01-17', weekCount: 18, phases: [
  { kind: 'teaching', name: '教学', firstDay: '2026-09-14', lastDay: '2027-01-01', weeks: [1, 16] },
  { kind: 'examination', name: '考试', firstDay: '2027-01-04', lastDay: '2027-01-15', weeks: [17, 18] },
] }], breaks: [{ id: 'winter', name: '寒假', firstDay: '2027-01-18', lastDay: '2027-02-20' }], events: [{ uid: 'registration', title: '示例注册', date: '2026-09-13' }] })
const educationTimetable = () => ({ institution: 'example-school', dataset: { schemaVersion: 1, term: '2026-autumn', timeZone: 'Asia/Shanghai', courses: [
  { teachingClassCode: 'EXAMPLE.01', title: '示例课程', meetings: [{ id: 'meeting-1', start: '2026-10-26T09:00', end: '2026-10-26T10:00' }] },
] } })

test('structured calendar subscriptions refresh full semantics, reject conflicts and restore offline', { skip: !runtime }, async () => {
  await withRoot('subs-academic-calendar-', async root => withFeedServer({ body: JSON.stringify(educationCalendar(1)) }, async server => {
    let id
    await withStack(root, async (subs, calendar, ctx) => {
      const added = await subs.addFeed({ url: server.url, label: '示例校历', format: 'academic-calendar' })
      assert.equal(added.refresh.state, 'ready')
      id = added.feed.id
      assert.equal(ctx.academicCalendar.query({ from: '2027-01-17' }).days[0].phase.kind, 'examination')
      const changed = educationCalendar(1)
      changed.terms[0].name = '新名称'
      server.set(JSON.stringify(changed))
      await assert.rejects(subs.refresh(id), /revision_conflict/)
      assert.equal(ctx.academicCalendar.query({ from: '2026-10-26' }).days[0].term.name, '秋季')
      changed.revision = 2
      server.set(JSON.stringify(changed))
      await subs.refresh(id)
      assert.equal(ctx.academicCalendar.query({ from: '2026-10-26' }).days[0].term.name, '新名称')
      await calendar.selectAnnotations({ group: 'academic-calendar', id: null })
      assert.equal(calendar.snapshot().events.length, 0)
      await subs.refresh(id)
      assert.equal(calendar.snapshot().events.length, 0, 'unselected calendars can refresh without becoming visible')
      await calendar.selectAnnotations({ group: 'academic-calendar', id: calendar.annotationChoices()[0].id })
    }, { academic: true })
    server.set('', 503)
    await withStack(root, async (subs, calendar, ctx) => {
      await subs.handles.get(id).ready
      assert.equal(ctx.academicCalendar.query({ from: '2026-10-26' }).days[0].term.name, '新名称')
      await assert.rejects(subs.refresh(id), /503/)
      assert.equal(calendar.snapshot().events.length, 1)
      await subs.updateFeed(id, { enabled: false })
      assert.deepEqual(calendar.annotationChoices(), [])
      assert.throws(() => ctx.academicCalendar.query({ from: '2026-10-26' }), /选择/)
      await calendar.selectAnnotations({ group: 'academic-calendar', id: null })
      await subs.updateFeed(id, { enabled: true })
      assert.equal(calendar.annotationChoices().length, 1)
      assert.equal(calendar.snapshot().events.length, 0, 'resuming respects the explicit no-calendar selection')
      await calendar.selectAnnotations({ group: 'academic-calendar', id: calendar.annotationChoices()[0].id })
      await subs.removeFeed(id)
      assert.deepEqual(calendar.annotationChoices(), [])
      assert.equal(calendar.snapshot().events.length, 0)
    }, { academic: true })
  }))
})

test('structured timetable subscriptions preserve notes, grouping and failure snapshots', { skip: !runtime }, async () => {
  await withRoot('subs-academic-timetable-', async root => withFeedServer({ body: JSON.stringify(educationTimetable()) }, async server => {
    let id, uid
    await withStack(root, async (subs, calendar, ctx) => {
      const added = await subs.addFeed({ url: server.url, format: 'academic-timetable' })
      assert.equal(added.refresh.state, 'ready')
      id = added.feed.id
      const [event] = calendar.snapshot().events
      uid = event.uid
      await calendar.putNote({ source: event.source, uid, text: '保留笔记' })
      const moved = educationTimetable()
      moved.dataset.courses[0].meetings[0].start = '2026-10-27T09:00'
      moved.dataset.courses[0].meetings[0].end = '2026-10-27T10:00'
      server.set(JSON.stringify(moved))
      await subs.refresh(id)
      assert.equal(calendar.snapshot().events[0].uid, uid)
      assert.equal(calendar.occurrences({ from: '2026-10-27', to: '2026-10-27' }).occurrences[0].originalStart, '2026-10-26T09:00')
      assert.equal(ctx.academicCalendar.courses()[0].dataset.courses[0].meetings[0].start, '2026-10-27T09:00')
      server.set('{invalid')
      await assert.rejects(subs.refresh(id))
      assert.equal(calendar.snapshot().events[0].uid, uid)
      assert.ok(calendar.notes({ scope: 'source' }).some(x => x.note?.text === '保留笔记'))
    }, { academic: true })
    await withStack(root, async (subs, calendar, ctx) => {
      await subs.handles.get(id).ready
      assert.equal(ctx.academicCalendar.courses().length, 1)
      await subs.updateFeed(id, { enabled: false })
      assert.deepEqual(ctx.academicCalendar.courses(), [])
      await subs.updateFeed(id, { enabled: true })
      assert.equal(ctx.academicCalendar.courses().length, 1)
      await subs.removeFeed(id)
      assert.equal(calendar.snapshot().events.length, 0)
      assert.equal(ctx.academicCalendar.courses().length, 0)
      assert.ok(calendar.unlinkedNotes({}).some(x => x.note?.text === '保留笔记'))
    }, { academic: true })
  }))
})

test('removing a disabled feed after restart clears its cached education data before offline re-add', { skip: !runtime }, async () => {
  await withRoot('subs-removed-cache-', async root => withFeedServer({ body: JSON.stringify(educationCalendar(1)) }, async server => {
    let id
    await withStack(root, async subs => {
      id = (await subs.addFeed({ url: server.url, format: 'academic-calendar' })).feed.id
      await subs.updateFeed(id, { enabled: false })
    }, { academic: true })
    // Delete while the format owner is absent; cleanup must survive another restart.
    await withStack(root, async subs => {
      const result = await subs.removeFeed(id)
      assert.equal(result.cleanupPending, true)
      assert.deepEqual(subs.feeds(), [])
    })
    server.set('', 503)
    await withStack(root, async (subs, calendar, ctx) => {
      const result = await subs.addFeed({ url: server.url, format: 'academic-calendar' })
      assert.match(result.refresh.error, /503/)
      assert.deepEqual(calendar.annotationChoices(), [])
      assert.equal(calendar.snapshot().events.length, 0)
      assert.throws(() => ctx.academicCalendar.query({ from: '2026-10-26' }), /选择/)
    }, { academic: true })
  }))
})

test('format unload rejects a late response and reload restores only the successful snapshot', { skip: !runtime }, async () => {
  let fiber, started
  await withRoot('subs-format-lifetime-', async root => withFeedServer({ body: JSON.stringify(educationTimetable()), onRequest: () => started?.() }, async server => {
    await withStack(root, async (subs, calendar, ctx) => {
      const { feed } = await subs.addFeed({ url: server.url, format: 'academic-timetable' })
      let release
      const arrival = new Promise(resolve => { started = resolve })
      server.hold(new Promise(resolve => { release = resolve }))
      const late = subs.refresh(feed.id)
      await arrival
      await fiber.dispose()
      assert.equal(calendar.snapshot().events.length, 0)
      const changed = educationTimetable()
      changed.dataset.courses[0].title = '不得应用的晚响应'
      server.set(JSON.stringify(changed)); release(); server.hold(undefined); started = undefined
      await late
      assert.equal(calendar.snapshot().events.length, 0)
      server.set('', 503)
      const { default: AcademicCalendar } = await import('../../../packages/dsh-academic-calendar/lib/index.js')
      await ctx.plugin(AcademicCalendar)
      await ctx.academicCalendar.ready
      await subs.handles.get(feed.id).ready
      await assert.rejects(subs.refresh(feed.id), /503/)
      assert.equal(calendar.snapshot().events[0].title, '示例课程')
      assert.equal(ctx.academicCalendar.courses()[0].dataset.courses[0].title, '示例课程')
    }, { academic: true, academicLoaded: value => { fiber = value } })
  }))
})

test('oversized responses are rejected before a format parser consumes them', async () => {
  const { boundedResponse } = await import('../lib/response.js')
  await assert.rejects(boundedResponse(new Response('x'.repeat(5 * 1024 * 1024 + 1))), /5 MiB/)
})

test('a new feed fetches once and its events land in the calendar', { skip: !runtime }, async () => {
  await withRoot('subs-first-fetch-', async root => {
    await withFeedServer({ body: holidayFile(
      allDay('national-2026', '国庆节假期', '20261001', '20261008'),
      allDay('makeup-2026-10-10', '调休上班', '20261010'),
    ) }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        assert.equal(added.feed.label, '中国节假日')
        assert.equal(added.refresh.applied, 2, 'tool reports expose the actual written count')
        assert.deepEqual(added.refresh.skipped, [], 'the whole file was read')
        const events = feedEvents(calendar)
        assert.equal(events.length, 2)
        assert.ok(events.some(event => event.title === '国庆节假期'))
        assert.ok(events.some(event => event.title === '调休上班'))
        const [feed] = subs.feeds()
        assert.ok(feed.lastSuccessAt, 'the success time is recorded')
        assert.equal(feed.lastError, undefined)
        assert.ok(calendar.sourceStatuses().some(status => status.label === '中国节假日'), 'the feed registers as a calendar source')
      })
    })
  })
})

test('actual OIDC backend and loopback services renew, fail closed and isolate account changes', { skip: !runtime }, async () => {
  bindRuntime()
  const { OidcAccountService } = await import('../../../packages/dsh-oidc/src/host/index.js')
  const { normalizeEnterpriseProfile } = await import('../../../packages/dsh-oidc/src/host/profile.js')
  let renewals = 0, allowedToken = 'synthetic-initial', deny = false, backend, pendingRequest, resource
  const tokenServer = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = new URLSearchParams(Buffer.concat(chunks).toString())
    assert.equal(body.get('grant_type'), 'refresh_token')
    renewals++
    allowedToken = 'synthetic-renewed-' + renewals
    if (!deny) resource?.set(holidayFile(allDay('class', '更新课程', '20261026')))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ access_token: allowedToken, refresh_token: 'synthetic-rotated-' + renewals, token_type: 'Bearer', expires_in: 3600 }))
  })
  await new Promise(done => tokenServer.listen(0, '127.0.0.1', done))
  const issuer = `http://127.0.0.1:${tokenServer.address().port}`
  const profile = normalizeEnterpriseProfile({ schemaVersion: 'dsh-oidc/v1alpha1', id: 'test-school', displayName: '示例学校', allowInsecureDevelopment: true,
    oidc: { issuer, clientId: 'synthetic-client', scopes: ['openid', 'profile', 'offline_access'] } })
  try {
    await withRoot('subs-oidc-http-', async root => withFeedServer({ body: holidayFile(allDay('class', '示例课程', '20261026')), onRequest: request => {
      pendingRequest?.()
      const auth = request.headers.authorization
      assert.ok(auth?.startsWith('Bearer synthetic-'))
    } }, async server => {
      resource = server
      // This service is a different origin from the issuer, so the exact Host
      // destination capability is required. Development HTTP is loopback-only.
      const config = { allowInsecureDevelopment: true, authorizedServices: [{ profileID: profile.id, url: server.url }] }
      await withStack(root, async (subs, calendar, ctx) => {
        await assert.rejects(backend.authorizedFetch(profile.id, server.url), /configured organization origin/)
        const first = await subs.addFeed({ url: server.url, profileID: profile.id })
        assert.equal(first.refresh.state, 'ready')
        const original = calendar.snapshot().events[0]
        await calendar.putNote({ source: original.source, uid: original.uid, text: '账号A笔记' })
        // Force a real HTTP 401 at the resource service, then recover through
        // the real token endpoint on the next request.
        server.set('', 401)
        await subs.refresh(first.feed.id)
        assert.equal(renewals, 1)
        assert.equal(calendar.snapshot().events[0].title, '更新课程')
        deny = true; server.set('', 401)
        await assert.rejects(subs.refresh(first.feed.id), /HTTP 401/)
        assert.equal(calendar.snapshot().events[0].title, '更新课程', 'authorization failure preserves the last snapshot')
        assert.ok(subs.feeds()[0].lastError)
        deny = false; server.set(holidayFile(allDay('class', '旧账号晚响应', '20261026')))
        let release, started
        const arrived = new Promise(resolve => { started = resolve })
        server.hold(new Promise(resolve => { release = resolve }))
        pendingRequest = started
        const late = subs.refresh(first.feed.id)
        await arrived
        await ctx.oidcAccounts.logout(profile.id)
        release(); server.hold(undefined); pendingRequest = undefined
        await late
        assert.equal(calendar.snapshot().events.length, 0, 'logout hides account A immediately')
        await backend.saveSession(profile, { issuer, clientId: profile.oidc.clientId, accessToken: allowedToken, refreshToken: 'synthetic-b-refresh', expiresAt: Math.floor(Date.now() / 1000) + 3600, identity: { sub: 'student-b' } })
        await ctx.oidcAccounts.status(profile.id)
        server.set(holidayFile(allDay('class', '账号B课程', '20261027')))
        const second = await subs.addFeed({ url: server.url, profileID: profile.id })
        assert.equal(second.refresh.state, 'ready')
        assert.notEqual(first.feed.id, second.feed.id)
        assert.notEqual(original.source, calendar.snapshot().events[0].source)
        assert.equal(calendar.snapshot().events[0].title, '账号B课程')
        assert.ok(calendar.notes({ scope: 'source', source: original.source, uid: original.uid }).some(x => x.note?.text === '账号A笔记'))
        assert.ok(!JSON.stringify(subs.feeds()).includes('synthetic-renewed-'))
        server.set(JSON.stringify(educationTimetable()))
        const classes = await subs.addFeed({ url: server.url, profileID: profile.id, format: 'academic-timetable' })
        assert.equal(classes.refresh.state, 'ready')
        assert.equal(ctx.academicCalendar.courses().length, 1)
        await ctx.oidcAccounts.logout(profile.id)
        assert.deepEqual(ctx.academicCalendar.courses(), [], 'logout also hides education grouping and queries')
        assert.equal(calendar.snapshot().events.length, 0)
      }, { academic: true, config, oidcFactory: async ctx => {
        const secrets = new Map()
        ctx.provide('credentials')
        ctx.set('credentials', {
          resolve: async ref => secrets.has(ref) ? { value: secrets.get(ref) } : undefined,
          set: async (ref, value) => { secrets.set(ref, value) }, unset: async ref => { secrets.delete(ref) },
        })
        ctx.provide('webServer')
        ctx.set('webServer', { host: '127.0.0.1', port: 3080, register: () => () => {} })
        const { default: LlmRuntime } = await load('@deepseek-ai/dsh-llm')
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(OidcAccountService, { backend: 'web', profile, manageProductBrand: false })
        await ctx.oidcAccounts.backendReady
        backend = ctx.oidcAccounts.backend
        backend.discovery.set(profile.id, { tokenEndpoint: issuer + '/token' })
        await backend.saveSession(profile, { issuer, clientId: profile.oidc.clientId, accessToken: allowedToken, refreshToken: 'synthetic-refresh', expiresAt: Math.floor(Date.now() / 1000) + 3600, identity: { sub: 'student-a' } })
        return ctx.oidcAccounts
      } })
    }))
  } finally { await new Promise(done => { tokenServer.close(done); tokenServer.closeAllConnections() }) }
})

test('a changed feed replaces its snapshot without duplicates', { skip: !runtime }, async () => {
  await withRoot('subs-replace-', async root => {
    await withFeedServer({ body: holidayFile(
      allDay('national-2026', '国庆节假期', '20261001', '20261008'),
      allDay('makeup-2026-10-10', '调休上班', '20261010'),
    ) }, async ({ url, set }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        const id = added.feed.id
        set(holidayFile(
          allDay('national-2026', '国庆节假期', '20261001', '20261008'),
          allDay('new-year-2027', '元旦假期', '20270101', '20270103'),
        ))
        await subs.refresh(id)
        const events = feedEvents(calendar)
        assert.equal(events.length, 2, 'the second clean read replaced the first')
        assert.ok(events.some(event => event.uid === 'national-2026'))
        assert.ok(events.some(event => event.uid === 'new-year-2027'))
        assert.ok(!events.some(event => event.uid === 'makeup-2026-10-10'), 'an entry the feed dropped is gone')
      })
    })
  })
})

test('a failed refresh keeps the last good events and records the error', { skip: !runtime }, async () => {
  await withRoot('subs-failure-', async root => {
    const good = holidayFile(allDay('national-2026', '国庆节假期', '20261001', '20261008'))
    await withFeedServer({ body: good }, async ({ url, set }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        const id = added.feed.id
        set('', 500)
        await assert.rejects(() => subs.refresh(id), /刷新失败/)
        assert.equal(feedEvents(calendar).length, 1, 'the last good fetch stays after a failure')
        let [feed] = subs.feeds()
        assert.match(feed.lastError, /500/)
        set(good)
        await subs.refresh(id)
        ;[feed] = subs.feeds()
        assert.equal(feed.lastError, undefined, 'a recovered feed clears its error')
      })
    })
  })
})

test('text that is not a calendar fails the refresh and keeps the events', { skip: !runtime }, async () => {
  await withRoot('subs-not-ics-', async root => {
    await withFeedServer({ body: holidayFile(allDay('national-2026', '国庆节假期', '20261001', '20261008')) }, async ({ url, set }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        set('<html>login page</html>')
        await assert.rejects(() => subs.refresh(added.feed.id), /刷新失败/)
        assert.equal(feedEvents(calendar).length, 1)
        assert.ok(subs.feeds()[0].lastError)
      })
    })
  })
})

test('feed configuration and events survive a restart', { skip: !runtime }, async () => {
  await withRoot('subs-restart-', async root => {
    await withFeedServer({ body: holidayFile(
      allDay('national-2026', '国庆节假期', '20261001', '20261008'),
      allDay('makeup-2026-10-10', '调休上班', '20261010'),
    ) }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        await subs.addFeed({ label: '中国节假日', url })
        assert.equal(feedEvents(calendar).length, 2)
      })
      await withStack(root, async (subs, calendar) => {
        const [feed] = subs.feeds()
        assert.equal(feed.label, '中国节假日')
        assert.ok(feed.lastSuccessAt, 'the outcome from the previous run persisted')
        assert.equal(feedEvents(calendar).length, 2, 'the feed re-registers and its events are visible again')
        assert.ok(calendar.sourceStatuses().some(status => status.label === '中国节假日'))
      })
    })
  })
})

test('disabling hides a feed until it is enabled again', { skip: !runtime }, async () => {
  await withRoot('subs-toggle-', async root => {
    await withFeedServer({ body: holidayFile(allDay('national-2026', '国庆节假期', '20261001', '20261008')) }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        const id = added.feed.id
        await subs.updateFeed(id, { enabled: false })
        assert.equal(feedEvents(calendar).length, 0, 'a disabled feed is hidden')
        assert.equal(subs.feeds()[0].enabled, false)
        await subs.updateFeed(id, { enabled: true })
        assert.equal(feedEvents(calendar).length, 1, 'enabling restores the same events')
      })
    })
  })
})

test('unsubscribing clears the feed events, and the same feed can return', { skip: !runtime }, async () => {
  await withRoot('subs-remove-', async root => {
    await withFeedServer({ body: holidayFile(allDay('national-2026', '国庆节假期', '20261001', '20261008')) }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        await subs.removeFeed(added.feed.id)
        assert.equal(subs.feeds().length, 0)
        assert.equal(feedEvents(calendar).length, 0, 'removal clears the feed events')
        const again = await subs.addFeed({ label: '中国节假日', url })
        assert.equal(again.feed.id, added.feed.id, 'the same URL keeps its identity')
        assert.equal(feedEvents(calendar).length, 1)
      })
    })
  })
})

// The three races of a feed's lifetime. A refresh is in flight when its owner
// goes away — the feed is unsubscribed, or the whole service stops — and the
// response lands afterwards. What must hold: nothing crashes, nothing from the
// late response reaches the calendar, no source stays registered for a plugin
// that is gone, and the removed feed is never rescheduled.
/** A feed origin whose later responses wait on a gate the test opens. */
async function withGatedFeedServer(body) {
  let hits = 0
  let open = () => {}
  const gate = new Promise(resolve => { open = resolve })
  const server = createServer((request, response) => {
    hits += 1
    const answer = () => {
      response.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' })
      response.end(holidayFile(allDay(hits === 1 ? 'first-1' : 'late-1', hits === 1 ? '首次事件' : '迟到的事件', '20261101')))
    }
    if (hits === 1) answer()
    else void gate.then(answer)
  })
  await new Promise(ready => server.listen(0, '127.0.0.1', ready))
  try {
    return await body({ url: `http://127.0.0.1:${server.address().port}/feed.ics`, open, hits: () => hits })
  } finally {
    await new Promise(done => server.close(done))
  }
}

test('a refresh that lands after its feed was removed is skipped, not applied or rescheduled', { skip: !runtime }, async () => {
  await withRoot('subs-remove-race-', async root => {
    await withGatedFeedServer(async ({ url, open, hits }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '赛跑中的订阅', url })
        const late = subs.refresh(added.feed.id)
        await new Promise(settle => setTimeout(settle, 25))
        await subs.removeFeed(added.feed.id)
        open()
        const report = await late
        assert.equal(report.skipped, true, 'the late answer reports it wrote nothing')
        assert.equal(feedEvents(calendar).length, 0, 'removal still cleared everything')
        const settled = hits()
        await new Promise(settle => setTimeout(settle, 120))
        assert.equal(hits(), settled, 'a removed feed is never fetched again')
      })
    })
  })
})

test('stopping the service deregisters its sources, and a late response writes nothing', { skip: !runtime }, async () => {
  await withRoot('subs-shutdown-race-', async root => {
    await withGatedFeedServer(async ({ url, open }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '将被停止的订阅', url })
        assert.ok(calendar.sourceStatuses().some(status => status.label === '将被停止的订阅'))
        const late = subs.refresh(added.feed.id)
        await new Promise(settle => setTimeout(settle, 25))
        subs.shutdown()
        assert.ok(!calendar.sourceStatuses().some(status => status.label === '将被停止的订阅'),
          'no source stays registered for a stopped plugin')
        open()
        const report = await late
        assert.equal(report.skipped, true)
        // Deregistration hides the feed's events rather than deleting them
        // (that is what deregistering means), so the store is where the late
        // answer's absence is proven.
        assert.deepEqual(feedEvents(calendar).map(event => event.uid), [], 'deregistration hides the feed events of a stopped plugin')
        assert.deepEqual(calendar.store.snapshot().events.map(event => event.uid), ['first-1'], 'the late answer reached nobody')
      })
    })
  })
})

// A school feed freezes its series and lists one-off moves beside it — the
// `RECURRENCE-ID` shape. The moved date must show its new time, the refresh
// must not report degradation for it, and the source must be cleanly ready.
test('a one-off reschedule in the feed reaches the calendar at its new time', { skip: !runtime }, async () => {
  await withRoot('subs-recurrence-move-', async root => {
    const course = (...extra) => extra.flat()
    const body = holidayFile(
      course('BEGIN:VEVENT', 'UID:FORMAL-1', 'SUMMARY:形式化方法', 'DTSTART:20261027T090000', 'DTEND:20261027T102000', 'RRULE:FREQ=WEEKLY;COUNT=10', 'END:VEVENT'),
      course('BEGIN:VEVENT', 'UID:FORMAL-1', 'RECURRENCE-ID:20261103T090000', 'SUMMARY:形式化方法', 'DTSTART:20261103T110000', 'DTEND:20261103T122000', 'END:VEVENT'),
    )
    await withFeedServer({ body }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '课程表', url })
        assert.deepEqual(added.refresh.degraded, [], 'a carried move is not degradation')
        assert.deepEqual(added.refresh.skipped, [])
        const moved = calendar.occurrences({ from: '2026-11-03', to: '2026-11-03' }).occurrences
        assert.equal(moved.length, 1)
        assert.equal(moved[0].start, '2026-11-03T11:00', 'the rescheduled date shows the new time')
        assert.equal(moved[0].end, '2026-11-03T12:20')
        const regular = calendar.occurrences({ from: '2026-11-10', to: '2026-11-10' }).occurrences
        assert.equal(regular[0].start, '2026-11-10T09:00', 'the rest of the series keeps its time')
        const [feed] = subs.feeds()
        assert.equal(feed.state, 'ready')
        assert.equal(feed.lastError, undefined)
      })
    })
  })
})


test('disable and re-enable invalidates the old request before a new refresh', { skip: !runtime }, async () => {
  await withRoot('subs-reenable-race-', async root => withGatedFeedServer(async ({ url, open, hits }) => {
    await withStack(root, async (subs, calendar) => {
      const { feed } = await subs.addFeed({ url })
      const pending = subs.refresh(feed.id)
      while (hits() < 2) await new Promise(resolve => setTimeout(resolve, 5))
      await subs.updateFeed(feed.id, { enabled: false })
      await subs.updateFeed(feed.id, { enabled: true })
      open()
      assert.equal((await pending).skipped, true)
      assert.equal(feedEvents(calendar)[0].title, '首次事件')
      await subs.refresh(feed.id)
      assert.equal(feedEvents(calendar)[0].title, '迟到的事件')
    })
  }))
})

test('authorized subscriptions isolate accounts and reject late replies even if transport ignores cancellation', { skip: !runtime }, async () => {
  const url = 'https://school.example.test/timetable.ics'
  let subject = 'student-a'
  let calls = 0
  let release
  const oidc = {
    accountIdentity: async profileID => subject ? { profileID, subject, accountID: `issuer:${subject}` } : null,
    authorizedFetch: async (profileID, target, init, authorization) => {
      assert.equal(profileID, 'school')
      assert.equal(target, url)
      assert.deepEqual(authorization, { serviceURL: url })
      assert.equal(init.redirect, 'error')
      calls++
      if (calls === 2) await new Promise(resolve => { release = resolve })
      return new Response(holidayFile(allDay('class-1', subject === 'student-a' ? 'A' : 'B', '20261026')))
    },
  }
  await withRoot('subs-authorized-', async root => withStack(root, async (subs, calendar, ctx) => {
    await assert.rejects(subs.addFeed({ url: 'https://unapproved.example.test/x', profileID: 'school' }), /授权/)
    assert.equal(calls, 0)
    const first = await subs.addFeed({ url, profileID: 'school' })
    assert.equal(feedEvents(calendar)[0].title, 'A')
    const pending = subs.refresh(first.feed.id)
    while (!release) await new Promise(resolve => setTimeout(resolve, 5))
    subject = 'student-b'
    ctx.emit('oidc/accounts-changed', { profileID: 'school', state: 'connected', authorizationChanged: true })
    release()
    assert.equal((await pending).skipped, true)
    assert.equal(calendar.snapshot().events.length, 0, 'old-account cached events are hidden')
    const second = await subs.addFeed({ url, profileID: 'school' })
    assert.notEqual(second.feed.id, first.feed.id)
    assert.equal(calendar.snapshot().events.length, 1)
    assert.equal(calendar.snapshot().events[0].title, 'B')
    subject = null
    ctx.emit('oidc/accounts-changed', { profileID: 'school', state: 'signed_out' })
    assert.equal(calendar.snapshot().events.length, 0)
    const serialized = JSON.stringify([...subs.table.entries()])
    assert.ok(!serialized.includes('Bearer'))
    assert.ok(!serialized.includes('accessToken'))
  }, { oidc, config: { authorizedServices: [{ profileID: 'school', url }] } }))
})


test('multiple feeds refresh independently and a failed feed recovers on its scheduled retry', { skip: !runtime }, async () => {
  await withRoot('subs-independent-', async root => withFeedServer({ body: holidayFile(allDay('a', 'A', '20261001')) }, async first =>
    withFeedServer({ body: holidayFile(allDay('b', 'B', '20261002')) }, async second => withStack(root, async (subs, calendar) => {
      const a = (await subs.addFeed({ url: first.url })).feed
      await subs.addFeed({ url: second.url })
      first.set('', 503)
      second.set(holidayFile(allDay('b', 'B updated', '20261002')))
      const outcome = await subs.refreshAll()
      assert.match(outcome[a.id].error, /503/)
      assert.deepEqual(feedEvents(calendar).map(x => x.title).sort(), ['A', 'B updated'])
      first.set(holidayFile(allDay('a', 'A recovered', '20261001')))
      subs.schedule(subs.feedConfigs.get(a.id), 10)
      const deadline = Date.now() + 3000
      while (!feedEvents(calendar).some(x => x.title === 'A recovered')) {
        if (Date.now() > deadline) throw new Error('scheduled recovery did not run')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(subs.feedConfigs.get(a.id).lastError, undefined)
      assert.equal(feedEvents(calendar).length, 2)
    }))))
})

test('unsupported recurrence warnings persist and are exposed after automatic reads', { skip: !runtime }, async () => {
  const body = holidayFile('BEGIN:VEVENT', 'UID:monthly', 'SUMMARY:Monthly', 'DTSTART:20261001T090000', 'RRULE:FREQ=MONTHLY;COUNT=3', 'END:VEVENT')
  await withRoot('subs-warnings-', async root => withFeedServer({ body }, async ({ url }) => {
    await withStack(root, async subs => {
      const result = await subs.addFeed({ url })
      assert.equal(result.refresh.degraded.length, 1)
      assert.match(subs.feeds()[0].warnings[0], /unsupported frequency MONTHLY/)
    })
    await withStack(root, async subs => assert.match(subs.feeds()[0].warnings[0], /unsupported frequency MONTHLY/))
  }))
})
