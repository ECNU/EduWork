// What the week view actually draws, when two records share an identifier.
//
// A uid is only unique within its source: a personal entry and an imported class
// can both be numbered `MATH101-01`. React matches children by key, so a key that
// names only the uid gives two different records one identity, and from then on the
// view stops reconciling — a record it no longer holds keeps its place on screen,
// and the reader deletes a class that stays there.
//
// The assertion is therefore about the drawing and not only about the data: the
// data is right in both cases, and only the picture is wrong.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { installDom } from './support/mini-dom.js'
import { loadBundle } from './support/load-bundle.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = createRequire(join(runtime ?? process.cwd(), 'package.json'))
const runtimeParent = pathToFileURL(join(runtime ?? process.cwd(), 'package.json')).href

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
const panelUrl = new URL('./.render/calendar-panel.cjs', import.meta.url)
const SOURCE = 'ecnu:timetable'

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

/** The calendar service over a temporary storage root. */
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
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return { container, root, React, act }
}

/** Every block the week view draws, in document order. */
function blocks(container) {
  return container.descendants().filter(element =>
    element.localName === 'button' && element.getAttribute('data-occurrence'))
}

/** One button whose visible text matches, or `undefined`. */
function findButton(container, pattern) {
  return container.descendants().find(element =>
    element.localName === 'button' && pattern.test(element.textContent))
}

/**
 * Let `body` run until it stops throwing, or give up.
 *
 * The panel writes, then re-reads, then redraws, and each of those turns needs the
 * event loop rather than a microtask: the storage backend resolves its writes on
 * real turns. Waiting for the outcome is honest about that; assuming a fixed number
 * of `Promise.resolve()` turns would pass or fail on timing rather than on behaviour.
 */
async function until(act, body, timeout = 5000) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      return await body()
    } catch (error) {
      if (Date.now() > deadline) throw error
      await act(async () => { await new Promise(done => setTimeout(done, 50)) })
    }
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

test('the week draws what it holds when two records share an identifier', { skip: !runtime }, async () => {
  await withRoot('eduwork-panel-key-', async (root) => {
    await withCalendar(root, async ({ host, service }) => {
      const tuesday = tuesdayOfThisWeek()
      // The same number in both sources: one record each, drawn side by side.
      await host.putEvent({ uid: 'MATH101-01', title: '自己加的复习课', start: `${tuesday}T19:00`, end: `${tuesday}T20:00` })
      await host.applySource({
        source: SOURCE,
        events: [{ uid: 'MATH101-01', title: '高等数学 A', start: `${tuesday}T09:00`, end: `${tuesday}T11:35` }],
      })
      assert.equal(host.occurrences({ from: tuesday, to: tuesday }).occurrences.length, 2, 'two records are on that day')

      const { container, root: mounted, act } = await mountPanel(service)
      try {
        const drawn = blocks(container)
        assert.equal(drawn.length, 2, 'the week draws both, once each')
        const keys = drawn.map(element => element.getAttribute('data-occurrence'))
        assert.equal(new Set(keys).size, 2, 'and gives each its own identity')

        // Delete the imported one through the panel's own two steps.
        const imported = drawn.find(element => (element.getAttribute('data-occurrence') ?? '').startsWith(`${SOURCE}\u0000`))
        assert.ok(imported, 'the imported class is on the week view')
        await act(async () => { imported.click() })
        const remove = findButton(container, /^删除日程$/)
        assert.ok(remove, 'the dialog offers to delete it')
        await act(async () => { remove.click() })
        const confirm = findButton(container, /^删除$/)
        assert.ok(confirm, 'and asks to confirm')
        await act(async () => { confirm.click() })

        await until(act, async () => {
          assert.deepEqual(
            (await host.snapshot()).events.map(event => `${event.source}/${event.uid}`),
            ['manual/MATH101-01'],
            'the imported record went and the personal one stayed',
          )
        })

        // The drawing has to follow. A view still showing the deleted class is the
        // defect this file exists for: the data was right and the picture was not.
        await until(act, async () => {
          assert.deepEqual(
            blocks(container).map(element => element.getAttribute('data-occurrence')),
            [`manual\u0000MATH101-01\u0000${tuesday}T19:00`],
            'and the week redrew, leaving no block for the record it no longer holds',
          )
        })
      } finally {
        await mounted.unmount()
      }
    })
  })
})
