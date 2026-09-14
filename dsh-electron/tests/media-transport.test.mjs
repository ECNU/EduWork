import assert from 'node:assert/strict'
import test from 'node:test'
import { MEDIA_BLOCK_BYTES, fetchDesktopResponse, fetchDesktopProtocolResponse } from '../src/media-transport.mjs'

test('protocol stops new requests and settles a teardown race without hiding live failures', async () => {
  const request = new Request('dsh-app://app/api/settings/describe')
  let closing = true, calls = 0, rejectFetch
  const host = { fetch() { calls++; return new Promise((_, reject) => { rejectFetch = reject }) } }
  assert.equal((await fetchDesktopProtocolResponse(host, request, () => closing)).status, 503)
  assert.equal(calls, 0)
  closing = false
  const pending = fetchDesktopProtocolResponse(host, request, () => closing)
  closing = true
  rejectFetch(new Error('request pipe is unavailable'))
  assert.equal((await pending).status, 503)
  closing = false
  const failure = new Error('live backend failed')
  const live = fetchDesktopProtocolResponse(host, request, () => closing)
  rejectFetch(failure)
  await assert.rejects(live, error => error === failure)
})

function fixture() {
  const file = new Uint8Array(MEDIA_BLOCK_BYTES * 3 + 91).map((_, i) => i % 251)
  let active = 0, requests = 0
  return {
    file, get active() { return active }, get requests() { return requests },
    async fetch(request) {
      const range = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.get('range') ?? '')
      const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : file.length - 1
      const headers = { 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'content-type': 'audio/wav', 'content-disposition': "inline; filename*=UTF-8''fixture.wav", ...(range ? { 'content-range': `bytes ${start}-${end}/${file.length}` } : {}) }
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })
      requests++; active++
      let offset = start
      const body = new ReadableStream({ pull(controller) { if (offset > end) { active--; controller.close(); return }; const next = Math.min(end + 1, offset + 65536); controller.enqueue(file.slice(offset, next)); offset = next }, cancel() { active-- } })
      return new Response(body, { status: range ? 206 : 200, headers })
    },
  }
}
test('a paused large response leaves no active Host body, and retains the full bytes and headers', async () => {
  const host = fixture()
  const response = await fetchDesktopResponse(host, new Request('dsh-app://app/api/artifactPreview/file?token=synthetic'))
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(first.value.length, MEDIA_BLOCK_BYTES)
  assert.equal(host.active, 0)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(host.requests, 1, 'No eager full-file read while paused')
  const parts = [first.value]
  for (;;) { const next = await reader.read(); if (next.done) break; parts.push(next.value) }
  assert.deepEqual(Buffer.concat(parts), Buffer.from(host.file))
  assert.match(response.headers.get('content-disposition'), /fixture.wav/)
  assert.equal(host.active, 0)
})
test('partial ranges retain status and bounds; cancellation stops further reads', async () => {
  const host = fixture()
  const request = new Request('dsh-app://app/api/artifactPreview/file?token=synthetic', { headers: { range: `bytes=37-${MEDIA_BLOCK_BYTES + 72}` } })
  const response = await fetchDesktopResponse(host, request)
  assert.equal(response.status, 206)
  const reader = response.body.getReader()
  assert.deepEqual((await reader.read()).value, host.file.slice(37, 37 + MEDIA_BLOCK_BYTES))
  await reader.cancel()
  assert.equal(host.active, 0); assert.equal(host.requests, 1)
})
test('a file changing size between HEAD and a data block fails instead of mixing data', async () => {
  const host = fixture(), original = host.fetch.bind(host)
  host.fetch = async request => {
    const response = await original(request)
    if (request.method === 'GET') response.headers.set('content-range', 'bytes 0-262143/9999999')
    return response
  }
  const response = await fetchDesktopResponse(host, new Request('dsh-app://app/api/artifactPreview/file?token=synthetic'))
  await assert.rejects(response.arrayBuffer(), /changed/)
  assert.equal(host.active, 0)
})
