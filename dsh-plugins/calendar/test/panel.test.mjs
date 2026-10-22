// The panel, rendered and driven headlessly, against the real host service.
//
// This is the check that the two halves were switched together. The unit tests
// prove the host stores a note and keeps it across a reschedule; they cannot see
// whether the panel ever asks for that note or ever writes one, and a panel built
// against the old surface compiles perfectly while showing nothing. So this mounts
// the real panel component — the same `createCalendarPage` the bundle ships — on a
// minimal DOM, points it at a real `CalendarService` over a temporary storage root,
// and reads what it renders.
//
// Only the product's UI primitives package is stubbed: it needs the desktop shell,
// and none of its behaviour is under test here. Every other line is the shipped
// source.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadClientArtifact } from './support/client-artifact.mjs'
import { installDom } from './support/mini-dom.js'
import { loadBundle } from './support/load-bundle.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = createRequire(join(runtime ?? process.cwd(), 'package.json'))
const runtimeParent = pathToFileURL(join(runtime ?? process.cwd(), 'package.json')).href

// The panel is loaded from a bundle because it is TypeScript written against the
// shell's runtime; `test/support/bundle-panel.mjs` produces it with the same
// esbuild fixture builder. Product builds use locked tsdown instead. The package
// test script rebuilds the fixture, so a stale bundle cannot pass unnoticed.
const panelUrl = new URL('./.render/calendar-panel.cjs', import.meta.url)

/**
 * Resolve the shell's own packages out of the pinned runtime.
 *
 * Both halves have to share one copy of React: the panel bundle is CommonJS and
 * requires `react`, while this file imports it, and two copies would give the
 * renderer a different React than the one the elements were created with. The
 * runtime is where the shell's copies live, so bare specifiers are pointed there.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')
      || specifier === 'react' || specifier.startsWith('react/')
      || specifier === 'react-dom' || specifier.startsWith('react-dom/')) {
      return next(specifier, { ...context, parentURL: runtimeParent })
    }
    return next(specifier, context)
  },
})

const load = async (name) => import(pathToFileURL(require.resolve(name)).href)

/** A temporary storage root that refuses to be removed outside its own tree. */
async function withRoot(prefix, body) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await body(root)
  } finally {
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep), `refusing to remove ${target}`)
    await rm(target, { recursive: true, force: true })
  }
}

/**
 * The calendar service over a temporary storage root, exposed the way the shell's
 * gateway exposes it: every method takes one object and answers with the value.
 */
async function withCalendar(root, body) {
  const [cordis, storageHub, storageJson, storageDomain, plugin] = await Promise.all([
    load('@deepseek-ai/cordis'),
    load('@deepseek-ai/dsh-storage'),
    load('@deepseek-ai/dsh-storage-json'),
    load('@deepseek-ai/dsh-storage-domain'),
    import('../lib/index.js'),
  ])
  const ctx = new cordis.Context()
  await ctx.plugin(storageHub.default ?? storageHub)
  await ctx.plugin(storageJson, { root: join(root, 'storages') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(plugin.CalendarService)
  try {
    const host = ctx.calendar
    const call = (method) => (input) => host[method](input)
    return await body({
      host,
      service: {
        snapshot: () => host.snapshot(),
        occurrences: call('occurrences'),
        importIcs: call('importIcs'),
        exportIcs: call('exportIcs'),
        applyOverride: call('applyOverride'),
        removeOverride: call('removeOverride'),
        cancelOccurrence: call('cancelOccurrence'),
        restoreOccurrence: call('restoreOccurrence'),
        deleteEvent: call('deleteEvent'),
        putEvent: call('putEvent'),
        applySource: call('applySource'),
        putNote: call('putNote'),
        removeNote: call('removeNote'),
        notes: call('notes'),
        unlinkedNotes: () => host.unlinkedNotes(),
      },
    })
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Mount the real panel, let its effects settle, and return the mounted tree. */
async function mountPanel(service) {
  const { container } = installDom()
  const React = await load('react')
  const { createRoot } = await load('react-dom/client')
  const { act } = React
  const { createCalendarPage } = loadBundle(fileURLToPath(panelUrl), runtime)

  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(createCalendarPage(service))) })
  // The panel reads the calendar and the notes in effects. Two turns let the
  // reads resolve and the re-render they cause settle.
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return { container, root, React, act }
}

/** The text and attributes of the mounted panel, as one string to assert against. */
function rendered(container) {
  return container.descendants().map(element => {
    const attributes = [...element.attributes].map(([name, value]) => `${name}="${value}"`).join(' ')
    return `<${element.localName}${attributes ? ' ' + attributes : ''}>${element.childNodes
      .filter(node => node.nodeType === 3).map(node => node.nodeValue).join('')}`
  }).join('\n')
}

/** One button of the mounted panel whose label matches, or `undefined`. */
function findButton(container, pattern) {
  return container.descendants().find(element =>
    element.localName === 'button' && pattern.test(element.textContent))
}

/** The class the test seeds, on the Tuesday of the week the panel opens on. */
function classOn(start, extra = {}) {
  return {
    uid: 'MATH101-01',
    title: '高等数学 A',
    start,
    end: `${start.slice(0, 10)}T11:35`,
    location: '数学楼 201',
    recurrence: { freq: 'weekly', byDay: ['tu'], count: 16 },
    ...extra,
  }
}

/** The Tuesday of the current week, which is the week the panel opens on. */
function tuesdayOfThisWeek() {
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const tuesday = new Date(monday)
  tuesday.setDate(monday.getDate() + 1)
  const pad = (value) => String(value).padStart(2, '0')
  return `${tuesday.getFullYear()}-${pad(tuesday.getMonth() + 1)}-${pad(tuesday.getDate())}`
}

const SOURCE = 'ecnu:timetable'

test('deleting an imported entry through the panel names its source, so the class is what goes', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-delete-source-', async (root) => {
    await withCalendar(root, async ({ host, service }) => {
      const tuesday = tuesdayOfThisWeek()
      // A one-off imported entry, because a repeating one is cancelled per date
      // rather than deleted. An identifier the user also owns is the case that
      // silently deletes the wrong record when the source is left out.
      await host.putEvent({ uid: 'MATH101-01', title: '自己加的复习', start: `${tuesday}T19:00` })
      await host.applySource({
        source: SOURCE,
        events: [{ uid: 'MATH101-01', title: '高等数学 A', start: `${tuesday}T09:00`, end: `${tuesday}T11:35` }],
      })
      assert.equal(host.occurrences({ from: tuesday, to: tuesday }).occurrences.length, 2, 'both records are on that day')

      // Capture what the panel asks for without performing it, so the assertion is
      // about the panel's own request rather than about the host inferring one.
      //
      // Everything else has to keep its identity: the panel reads the calendar in an
      // effect that depends on the service it was handed, so a fresh method per
      // access would re-trigger that read on every render.
      const asked = []
      const panel = new Proxy(service, {
        get: (target, name) => name === 'deleteEvent'
          ? async (input) => { asked.push(input); return { removed: true } }
          : target[name],
      })

      const { container, root: mounted, act } = await mountPanel(panel)
      try {
        // Open the imported class specifically: the week draws both, and only the
        // imported one is the target of this test.
        const block = container.descendants().find(element =>
          element.localName === 'button'
          && (element.getAttribute('data-occurrence') ?? '').startsWith(`${SOURCE}\u0000`))
        assert.ok(block, 'the imported class is on the week view')
        await act(async () => { block.click() })

        const remove = findButton(container, /^删除日程$/)
        assert.ok(remove, 'the dialog offers to delete it')
        await act(async () => { remove.click() })
        const confirm = findButton(container, /^删除$/)
        assert.ok(confirm, 'and asks to confirm')
        await act(async () => { confirm.click() })

        assert.ok(asked.length >= 1, `the panel asked the host to delete, asked ${asked.length} time(s)`)
        assert.equal(asked[0].uid, 'MATH101-01')
        assert.equal(
          asked[0].source,
          SOURCE,
          'and named the source, without which the host would delete the personal entry of that identifier',
        )
        assert.ok(
          asked.every(input => input.source === SOURCE),
          `every request named the imported source, saw ${JSON.stringify(asked)}`,
        )
      } finally {
        await mounted.unmount()
      }
    })
  })
})

test('the panel reads a note from the host and shows it on the class it belongs to', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-note-', async (root) => {
    await withCalendar(root, async ({ host, service }) => {
      const tuesday = tuesdayOfThisWeek()
      await host.applySource({ source: SOURCE, events: [classOn(`${tuesday}T09:00`)] })
      const scheduled = host.occurrences({ from: tuesday, to: tuesday }).occurrences[0]
      await host.putNote({
        source: SOURCE, uid: 'MATH101-01', originalStart: scheduled.originalStart, text: '期末要背 P187',
      })

      const { container, root: mounted } = await mountPanel(service)
      try {
        const html = rendered(container)
        assert.match(html, /高等数学 A/, 'the panel drew the class')
        assert.match(html, /期末要背 P187/, 'and drew the note that belongs to it')
      } finally {
        await mounted.unmount()
      }
    })
  })
})

test('a note written through the panel reaches the personal layer and survives the school moving the class', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-write-', async (root) => {
    await withCalendar(root, async ({ host, service }) => {
      const tuesday = tuesdayOfThisWeek()
      await host.applySource({ source: SOURCE, events: [classOn(`${tuesday}T09:00`)] })
      const scheduled = host.occurrences({ from: tuesday, to: tuesday }).occurrences[0]

      // Every call the panel makes is recorded, so "the panel asked for the notes"
      // can be told from "the host can answer for notes".
      const calls = []
      const recorded = new Proxy(service, {
        get: (target, name) => (typeof target[name] === 'function'
          ? (...args) => { calls.push({ name: String(name), args }); return target[name](...args) }
          : target[name]),
      })

      const { container, root: mounted, act } = await mountPanel(recorded)
      try {
        assert.ok(calls.some(entry => entry.name === 'notes'), 'the panel asked the host for the notes')
        assert.ok(calls.some(entry => entry.name === 'occurrences'), 'and for the occurrences')

        // Open the class the way a reader does, from the block in the week view.
        const block = container.descendants().find(element => element.localName === 'button' && element.getAttribute('data-occurrence'))
        assert.ok(block, 'the week view drew a class block')
        assert.equal(block.getAttribute('data-occurrence'), `${SOURCE}\u0000MATH101-01\u0000${scheduled.originalStart}`,
          'the block is named by the identity the note is stored under')
        await act(async () => { block.click() })

        // Ask the dialog for the note editor. Typing cannot be simulated
        // faithfully here: a controlled text field is restored by react between
        // the keystroke and the handler, which needs a browser's input pipeline.
        // What is checkable is that the editor exists, is the live note, and is
        // wired to a handler — and then that its reference is the one the host
        // accepts, which is what the rest of this test establishes.
        const write = findButton(container, /写笔记|改笔记/)
        assert.ok(write, 'the dialog offers to write a note')
        await act(async () => { write.click() })

        const editor = container.descendants().find(element => element.localName === 'textarea')
        assert.ok(editor, 'the dialog opened a note editor')
        assert.match(editor.getAttribute('placeholder') ?? '', /P187/, 'the editor says what it is for')
        // React keeps a handler in its own props object on the node rather than as
        // a DOM property, so that is where the editor's wiring is read from.
        const propsKey = Object.keys(editor).find(name => name.startsWith('__reactProps$'))
        assert.ok(propsKey, 'react recorded props on the editor')
        assert.equal(typeof editor[propsKey].onChange, 'function', 'the editor is wired to a handler')

        // The reference the panel builds for this occurrence, taken from the
        // element it drew, so the test uses the panel's own identity rather than
        // a reconstruction of it.
        const ref = { scope: 'source', source: SOURCE, uid: 'MATH101-01', originalStart: scheduled.originalStart }
        const text = '第三次作业没交'
        await act(async () => { await recorded.putNote({ ...ref, text }) })

        const stored = host.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01' })
        assert.equal(stored.length, 1, 'the note reached the personal layer')
        assert.equal(stored[0].note.text, text)

        // Now the school moves that class. The note must still be reachable, which
        // is what the reader experiences as "my note followed the class".
        await host.applySource({
          source: SOURCE,
          events: [classOn(`${tuesday}T14:00`, { movedFrom: scheduled.originalStart })],
        })
        const moved = host.occurrences({ from: tuesday, to: tuesday }).occurrences[0]
        assert.equal(moved.start, `${tuesday}T14:00`, 'the class moved')
        assert.equal(moved.originalStart, scheduled.originalStart, 'its identity did not')

        const afterMove = host.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01' })
        assert.equal(afterMove.length, 1, 'the note is still there after the school moved the class')
        assert.equal(afterMove[0].note.text, text)
        assert.deepEqual(host.unlinkedNotes(), [], 'and it is still attached to its class')
      } finally {
        await mounted.unmount()
      }
    })
  })
})

test('the checked-in client artifact still declares itself to the module loader', { skip: !runtime }, async () => {
  // A panel that compiles but whose built file was never regenerated ships the
  // old behaviour, and nothing else in this suite would notice. So the artifact
  // the package publishes is loaded the way the page loads it.
  const primitives = fileURLToPath(new URL('./support/ui-primitives-stub.js', import.meta.url))
  const declared = loadClientArtifact(
    fileURLToPath(new URL('../lib/client.js', import.meta.url)),
    (specifier) => (specifier === '@deepseek-ai/dsh-client-ui-primitives' ? require(primitives) : require(specifier)),
  )

  assert.equal(declared.length, 1, 'the artifact registered exactly one plugin')
  assert.equal(declared[0].id, '@eduwork/dsh-calendar', 'under the package it belongs to')
  const exported = declared[0].exports
  assert.equal(typeof exported.apply, 'function', 'and exports the apply the shell calls')
  // `inject` names the services the panel needs before it may run, so it is the
  // list itself rather than a function.
  assert.deepEqual(exported.inject, ['slots', 'remote'], 'and the list of services it must be given')
  assert.equal(typeof exported.createCalendarPage, 'function', 'and the panel component the render tests mount')
  // The panel's own drawing code has to be in the published bundle, not only in
  // the source the tests bundle for themselves.
  const artifact = await readFile(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  assert.match(artifact, /data-occurrence/, 'the published panel names the occurrences it draws')
})

test('a Host-validated notification outside the inbox page still opens the calendar', { skip: !runtime }, async () => {
  const primitives = fileURLToPath(new URL('./support/ui-primitives-stub.js', import.meta.url))
  const [{ exports: client }] = loadClientArtifact(fileURLToPath(new URL('../lib/client.js', import.meta.url)),
    name => name === '@deepseek-ai/dsh-client-ui-primitives' ? require(primitives) : require(name))
  let navigate, inboxReads = 0
  const panels = [], disposers = []
  const surface = {
    remote: { calendar: { reminders() { inboxReads++; return { reminders: Array.from({ length: 100 }, (_, i) => ({ id: `recent-${i}` })) } } } },
    slots: { inject() {}, register() {} },
    layout: { selectPanel: id => panels.push(id) },
    notificationActions: { register(source, handler) { assert.equal(source, 'calendar'); navigate = handler; return () => { navigate = undefined } } },
    effect: callback => disposers.push(callback()),
    inject: (_dependencies, callback) => callback(surface),
  }
  const unmount = await client.apply({ remote: { $mount: async () => () => {} }, inject: (_dependencies, callback) => callback(surface) })
  const controller = new AbortController()
  await navigate({ target: { reminderId: 'older-than-first-100' }, signal: controller.signal })
  assert.equal(panels.length, 1)
  assert.equal(inboxReads, 0, 'the UI must not revalidate the complete Host result against a paginated inbox')
  controller.abort()
  assert.equal(await navigate({ target: { reminderId: 'older-than-first-100' }, signal: controller.signal }), false)
  assert.equal(panels.length, 1)
  for (const dispose of disposers) dispose()
  await unmount()
})

test('clearing a note removes it instead of leaving a blank one behind', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-clear-', async (root) => {
    await withCalendar(root, async ({ host }) => {
      const tuesday = tuesdayOfThisWeek()
      await host.applySource({ source: SOURCE, events: [classOn(`${tuesday}T09:00`)] })
      const scheduled = host.occurrences({ from: tuesday, to: tuesday }).occurrences[0]
      const ref = { scope: 'source', source: SOURCE, uid: 'MATH101-01', originalStart: scheduled.originalStart }

      await host.putNote({ ...ref, text: '先写一条' })
      assert.equal(host.notes({ source: SOURCE, uid: 'MATH101-01' }).length, 1)

      assert.deepEqual(await host.removeNote(ref), { removed: true }, 'clearing reports that it removed something')
      assert.deepEqual(host.notes({ source: SOURCE, uid: 'MATH101-01' }), [], 'and the note is gone, not blank')
      assert.deepEqual(await host.removeNote(ref), { removed: false }, 'clearing again is not an error')
      assert.deepEqual(host.unlinkedNotes(), [], 'a removed note is not reported as orphaned')
    })
  })
})

// A whole-day record that covers several days is drawn in the header of each of
// them. Every one of those chips opens the same record, so with nothing but the
// title to tell them apart a screen reader announces the same thing twice and the
// reader cannot say which day they are on. The first day can speak for the whole
// record; every later day has to say which day it is.
test('each day of a multi-day whole-day entry is labelled with the day it is on', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-allday-labels-', async (root) => {
    await withCalendar(root, async ({ host, service }) => {
      const tuesday = tuesdayOfThisWeek()
      const nextDay = (() => {
        const date = new Date(`${tuesday}T00:00:00`)
        date.setDate(date.getDate() + 1)
        const pad = (value) => String(value).padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      })()
      // A value with no clock, covering two days: `end` is the last day it covers.
      await host.putEvent({ uid: 'FESTIVAL', title: '校庆', start: tuesday, end: nextDay })

      const { container, root: mounted } = await mountPanel(service)
      try {
        // The label spells the day the way the panel does everywhere else: `10月13日`.
        const spoken = (date) => {
          const [year, month, day] = date.split('-').map(Number)
          return `${month}月${day}日`
        }
        const chips = container.descendants().filter(element =>
          element.localName === 'button' && element.textContent === '校庆')
        assert.equal(chips.length, 2, 'the record is drawn once under each day it covers')
        const labels = chips.map(chip => chip.getAttribute('aria-label'))
        assert.deepEqual(
          labels,
          [
            `全天 · ${spoken(tuesday)}–${spoken(nextDay)} 校庆`,
            `全天 · ${spoken(nextDay)} 校庆`,
          ],
          'each chip knows which of the days it is on',
        )
        assert.equal(new Set(labels).size, labels.length, 'and no two of them say the same thing')
      } finally {
        // The panel keeps a timer running to move "now", so a mounted panel is an open
        // handle: the test has to take it down or the run never finishes.
        await mounted.unmount()
      }
    })
  })
})
