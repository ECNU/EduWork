// Calendar annotations: week labels and range bands a data plugin supplies.
//
// These tests drive the registry the way the first provider — an institution's
// academic calendar — will: register, answer ranges, break, and dispose. What
// must hold is that annotations are only ever decoration: a provider that
// throws or answers outside the contract is dropped for that read while the
// others still show, and nothing a provider does can touch stored events.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `dsh-plugins/*` ships no node_modules: the Runtime pinned by the assembly
// provides storage and zod. Without one these tests skip, like the others.
const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined
const load = name => import(pathToFileURL(require.resolve(name)).href)

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      return nextResolve(specifier, context)
    },
  })
}

let modules
async function loadModules() {
  bindRuntime()
  modules ??= (async () => {
    const [cordis, hub, json, domain, plugin] = await Promise.all([
      load('@deepseek-ai/cordis'),
      load('@deepseek-ai/dsh-storage'),
      load('@deepseek-ai/dsh-storage-json'),
      load('@deepseek-ai/dsh-storage-domain'),
      import('../lib/index.js'),
    ])
    return { Context: cordis.Context, storageHub: hub, storageJson: json, storageDomain: domain, CalendarService: plugin.CalendarService }
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

/** Run one body against a started calendar service. */
async function withCalendar(root, body) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService } = await loadModules()
  const ctx = new Context()
  try {
    await ctx.plugin(storageHub.default ?? storageHub)
    await ctx.plugin(storageJson, { root: join(root, 'storages') })
    await ctx.plugin(storageDomain, { backend: 'json' })
    await ctx.plugin(CalendarService)
    return await body(ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

const RANGE = { from: '2026-10-12', to: '2026-11-15' }

test('a registered provider answers the range the view is reading', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-', async root => {
    await withCalendar(root, async calendar => {
      const handle = calendar.registerAnnotations({
        id: 'test-academic-calendar',
        annotationsFor: ({ from, to }) => ({
          weeks: [{ firstDay: '2026-10-12', text: '第 5 周 · 单周' }],
          spans: [
            { firstDay: from, lastDay: to, text: '教学', tone: 'quiet' },
            { firstDay: '2026-11-09', lastDay: '2026-11-15', text: '考试周', tone: 'highlight' },
          ],
        }),
      })
      const answer = await calendar.annotationsFor(RANGE)
      assert.deepEqual(answer.weeks, [{ firstDay: '2026-10-12', text: '第 5 周 · 单周' }])
      assert.equal(answer.spans.length, 2)
      assert.equal(answer.spans[0].text, '教学')
      assert.equal(answer.spans[1].tone, 'highlight')
      handle.dispose()
      assert.deepEqual(await calendar.annotationsFor(RANGE), { weeks: [], spans: [] }, 'a disposed provider shows nothing')
    })
  })
})

test('two providers merge, and a broken one never blanks the others', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-merge-', async root => {
    await withCalendar(root, async calendar => {
      calendar.registerAnnotations({
        id: 'weeks',
        annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '第 6 周' }], spans: [] }),
      })
      calendar.registerAnnotations({
        id: 'phases',
        annotationsFor: () => ({ weeks: [], spans: [{ firstDay: '2026-10-19', lastDay: '2026-10-25', text: '教学周' }] }),
      })
      calendar.registerAnnotations({ id: 'throws', annotationsFor: () => { throw new Error('network down') } })
      calendar.registerAnnotations({ id: 'wrong-shape', annotationsFor: () => ({ weeks: [{ firstDay: 'not-a-date', text: 'x' }] }) })
      calendar.registerAnnotations({ id: 'unknown-field', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-26', text: '第 7 周' }], spans: [], ignored: true }) })
      const answer = await calendar.annotationsFor(RANGE)
      // The last provider's answer carries a key the contract never heard of, so
      // the whole answer is rejected the way every strict schema here rejects —
      // its week is absent, not half-present.
      assert.deepEqual(answer.weeks.map(week => week.text), ['第 6 周'])
      assert.deepEqual(answer.spans.map(span => span.text), ['教学周'])
    })
  })
})

test('registration guards its own contract', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-register-', async root => {
    await withCalendar(root, async calendar => {
      assert.throws(() => calendar.registerAnnotations({ id: 'no-read' }), /annotationsFor/)
      assert.throws(() => calendar.registerAnnotations({ annotationsFor: () => ({}) }), /stable id/)
      const provider = { id: 'twice', annotationsFor: () => ({}) }
      calendar.registerAnnotations(provider)
      assert.throws(() => calendar.registerAnnotations(provider), /already registered/)
    })
  })
})

test('annotations are decoration: storing events alongside them changes nothing', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-events-', async root => {
    await withCalendar(root, async calendar => {
      calendar.registerAnnotations({
        id: 'around',
        annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '第 6 周' }], spans: [] }),
      })
      await calendar.putEvent({ uid: 'mine', title: '我的日程', start: '2026-10-20T10:00' })
      await calendar.annotationsFor(RANGE)
      assert.equal(calendar.snapshot().events.length, 1, 'annotations never write events')
      assert.equal(calendar.snapshot().events[0].uid, 'mine')
    })
  })
})

test('a provider that never answers is dropped at its deadline, not awaited forever', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-hang-', async root => {
    await withCalendar(root, async calendar => {
      calendar.registerAnnotations({ id: 'hung', annotationsFor: () => new Promise(() => {}) })
      calendar.registerAnnotations({ id: 'fine', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '第 6 周' }], spans: [] }) })
      const started = Date.now()
      const answer = await calendar.annotationsFor(RANGE)
      assert.ok(Date.now() - started < 10_000, 'the read returns without waiting on the hung provider')
      assert.deepEqual(answer.weeks.map(week => week.text), ['第 6 周'])
    })
  })
})

test('a week label longer than the contract allows drops that whole answer', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-length-', async root => {
    await withCalendar(root, async calendar => {
      calendar.registerAnnotations({ id: 'verbose', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '这是一个特别特别特别特别特别特别特别特别特别长的周次标注文本超过三十二个字符上限' }], spans: [] }) })
      assert.deepEqual((await calendar.annotationsFor(RANGE)).weeks, [])
    })
  })
})

test('two providers naming the same week keep registration order', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-priority-', async root => {
    await withCalendar(root, async calendar => {
      calendar.registerAnnotations({ id: 'first', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '先注册' }], spans: [] }) })
      calendar.registerAnnotations({ id: 'second', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '后注册' }], spans: [] }) })
      const answer = await calendar.annotationsFor(RANGE)
      assert.deepEqual(answer.weeks.map(week => week.text), ['先注册', '后注册'])
    })
  })
})

// Registration order is the priority whatever the clock did: a provider that
// answers late still comes first if it registered first. Merging as answers
// arrive would order them by response speed instead.
test('registration order wins even when the first provider answers last', { skip: !runtime }, async () => {
  await withRoot('calendar-annotations-priority-slow-', async root => {
    await withCalendar(root, async calendar => {
      const later = new Promise(resolve => setTimeout(() => resolve({ weeks: [{ firstDay: '2026-10-19', text: '慢的先注册' }], spans: [] }), 40))
      calendar.registerAnnotations({ id: 'first-slow', annotationsFor: () => later })
      calendar.registerAnnotations({ id: 'second-fast', annotationsFor: () => ({ weeks: [{ firstDay: '2026-10-19', text: '快的后注册' }], spans: [] }) })
      const answer = await calendar.annotationsFor(RANGE)
      assert.deepEqual(answer.weeks.map(week => week.text), ['慢的先注册', '快的后注册'])
    })
  })
})
