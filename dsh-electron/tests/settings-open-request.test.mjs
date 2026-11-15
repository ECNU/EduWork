import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsOpenRequest } from '../src/settings-open-request.mjs'

test('a startup request is sent once after the renderer becomes ready', async () => {
  let ready = false
  let sends = 0
  const request = createSettingsOpenRequest({
    ready: () => ready,
    send: async () => { sends += 1; return true },
  })
  await request.request()
  assert.equal(sends, 0)
  assert.equal(request.pending(), true)
  ready = true
  await request.flush()
  assert.equal(sends, 1)
  assert.equal(request.pending(), false)
})

test('a send the renderer has not accepted stays pending for the next ready signal', async () => {
  let sends = 0
  const request = createSettingsOpenRequest({
    send: async () => { sends += 1; return sends > 1 },
  })
  await request.request()
  assert.equal(sends, 1)
  assert.equal(request.pending(), true)
  await request.flush()
  assert.equal(sends, 2)
  assert.equal(request.pending(), false)
})

test('a rejected send stays pending without a timer retry', async () => {
  let sends = 0
  const request = createSettingsOpenRequest({
    send: async () => {
      sends += 1
      if (sends === 1) throw new Error('page is still loading')
      return true
    },
  })
  await request.request()
  assert.equal(sends, 1)
  assert.equal(request.pending(), true)
  await request.flush()
  assert.equal(sends, 2)
  assert.equal(request.pending(), false)
})

test('concurrent requests coalesce while one send is in flight', async () => {
  let sends = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const request = createSettingsOpenRequest({
    send: () => { sends += 1; return gate },
  })
  const first = request.request()
  const second = request.request()
  await Promise.resolve()
  assert.equal(sends, 1)
  release(true)
  await Promise.all([first, second])
  assert.equal(request.pending(), false)
})

test('separate clicks send again after the previous request was accepted', async () => {
  let sends = 0
  const request = createSettingsOpenRequest({
    send: async () => { sends += 1; return true },
  })
  await request.request()
  await request.request()
  assert.equal(sends, 2)
  assert.equal(request.pending(), false)
})
