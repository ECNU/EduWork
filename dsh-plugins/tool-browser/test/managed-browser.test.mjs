import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ManagedBrowser, managedBrowserOwners } from '../lib/managed-browser.js'

function fixture() {
  const launches = []
  const launch = async (profile, mode) => {
    const ctx = new EventEmitter(), pages = []
    ctx.pages = () => pages.filter(p => !p.isClosed())
    ctx.newPage = async () => {
      let closed = false, url = 'about:blank'
      const page = Object.assign(new EventEmitter(), { isClosed: () => closed, url: () => url, title: async () => 'fixture',
        goto: async value => { if (closed) throw Error('closed'); url = value },
        close: async () => { closed = true; page.emit('close') }, bringToFront: async () => {} })
      pages.push(page); ctx.emit('page', page); return page
    }
    ctx.close = async () => { for (const page of pages) await page.close(); ctx.emit('close') }
    await ctx.newPage()
    launches.push({ ctx, profile, mode })
    return ctx
  }
  return { launches, browser: new ManagedBrowser({ launch, profile: 'synthetic-profile' }) }
}

test('closed context is never treated as the old target; recovery reports a new blank target', async () => {
  const { browser, launches } = fixture()
  await assert.rejects(browser.page('background', { requireExisting: true }), /closed/)
  assert.equal(launches.length, 0)
  const page = await browser.page('background')
  await page.goto('https://example.test/old')
  await launches[0].ctx.close()
  await assert.rejects(browser.page('background', { requireExisting: true }), /closed/)
  assert.equal(launches.length, 1)
  const next = await browser.page('background')
  assert.equal(next.url(), 'about:blank')
  assert.match(browser.identity().notice, /reopened/)
  assert.equal(launches.length, 2)
  await browser.close()
})

test('a closed tab can be recovered or explicitly selected without stale IDs being reused', async () => {
  const { browser } = fixture()
  const first = await browser.page('background')
  await first.goto('https://example.test/a')
  const firstID = browser.identity().tabId
  const second = await browser.newTab()
  await second.goto('https://example.test/b')
  assert.equal((await browser.tabs()).length, 2)
  await second.close()
  await assert.rejects(browser.page('background', { requireExisting: true }), /closed/)
  assert.equal(await browser.page('background'), first)
  assert.equal(browser.identity().tabId, firstID)
  await assert.rejects(browser.select(999), /not found/)
  await browser.close()
  await browser.page('background')
  assert.notEqual(browser.identity().tabId, firstID)
  await browser.close()
})

test('intentional mode change reuses the profile and URL', async () => {
  const { browser, launches } = fixture()
  await (await browser.page('background')).goto('https://example.test/login')
  const visible = await browser.page('visible')
  assert.equal(visible.url(), 'https://example.test/login')
  assert.equal(launches[0].profile, launches[1].profile)
  await browser.close()
})

test('calls serialize per owner, different owners isolate state, canceled queued work does not run', async () => {
  const owners = managedBrowserOwners(() => fixture().browser), a = {}, b = {}, controller = new AbortController()
  let release, ran = false
  const first = owners.run(a, undefined, async browser => { await browser.page('background'); await new Promise(resolve => { release = resolve }); return browser })
  await new Promise(resolve => setImmediate(resolve))
  const canceled = owners.run(a, controller.signal, async () => { ran = true })
  controller.abort()
  const other = await owners.run(b, undefined, browser => browser)
  release()
  const one = await first
  assert.notEqual(one, other)
  await assert.rejects(canceled, /abort/i)
  assert.equal(ran, false)
  await owners.release(a)
  await assert.rejects(owners.run(a, undefined, () => {}), /disposed/)
  await owners.dispose()
})

test('disposing an owner drains a late launch, closes it and never runs queued actions', async () => {
  let completeLaunch, launched, queued = false
  const owners = managedBrowserOwners(() => {
    const { browser } = fixture()
    const launch = browser.launch
    browser.launch = async (...args) => {
      await new Promise(resolve => { completeLaunch = resolve })
      launched = await launch(...args)
      return launched
    }
    return browser
  })
  const owner = {}
  const running = owners.run(owner, undefined, (browser, signal) => browser.page('background').then(() => signal.throwIfAborted()))
  const next = owners.run(owner, undefined, () => { queued = true })
  const results = Promise.allSettled([running, next])
  await new Promise(resolve => setImmediate(resolve))
  const closing = owners.release(owner)
  completeLaunch()
  await closing
  assert.equal((await results).every(result => result.status === 'rejected'), true)
  assert.equal(queued, false)
  assert.deepEqual(launched.pages(), [])
  await owners.dispose()
})
