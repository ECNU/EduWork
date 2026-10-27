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
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
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
async function withStack(root, body) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService, CalendarSubscriptions } = await loadModules()
  const ctx = new Context()
  await ctx.plugin(storageHub.default ?? storageHub)
  await ctx.plugin(storageJson, { root: join(root, 'storages') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(CalendarService)
  await ctx.plugin(CalendarSubscriptions)
  assert.ok(ctx.calendarSubscriptions, 'the service is reachable as ctx.calendarSubscriptions')
  await ctx.calendarSubscriptions.ready
  try {
    return await body(ctx.calendarSubscriptions, ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** A local ICS origin whose body and status a test can change between reads. */
async function withFeedServer(initial, body) {
  let feedBody = initial.body
  let feedStatus = initial.status ?? 200
  const server = createServer((request, response) => {
    response.writeHead(feedStatus, { 'content-type': 'text/calendar; charset=utf-8' })
    response.end(feedStatus === 200 ? feedBody : '')
  })
  await new Promise(ready => server.listen(0, '127.0.0.1', ready))
  const url = `http://127.0.0.1:${server.address().port}/holidays.ics`
  try {
    return await body({ url, set: (next, status) => { feedBody = next; feedStatus = status ?? 200 } })
  } finally {
    await new Promise(done => server.close(done))
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

test('a new feed fetches once and its events land in the calendar', { skip: !runtime }, async () => {
  await withRoot('subs-first-fetch-', async root => {
    await withFeedServer({ body: holidayFile(
      allDay('national-2026', '国庆节假期', '20261001', '20261008'),
      allDay('makeup-2026-10-10', '调休上班', '20261010'),
    ) }, async ({ url }) => {
      await withStack(root, async (subs, calendar) => {
        const added = await subs.addFeed({ label: '中国节假日', url })
        assert.equal(added.feed.label, '中国节假日')
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
