import assert from 'node:assert/strict'
import { once } from 'node:events'
import { open, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileResponse, fileDisposition, serveLegacyStream, streamToken } from '../lib/stream.js'

async function fixture(t, size = 131072) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-preview-stream-'))
  const path = join(directory, '中文 file.mp4'), bytes = Buffer.alloc(size, 42)
  await writeFile(path, bytes)
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { path, mime: 'video/mp4', bytes }
}
const request = (options = {}) => new Request('dsh-app://app/api/artifactPreview/file?token=test', options)

test('opaque tickets reject paths, malformed tokens, duplicate query keys, and endpoint lookalikes', () => {
  const ticket = 'A'.repeat(32)
  for (const path of [`/api/artifactPreview/file?token=${ticket}`, `/chatecnu-work/artifacts/${ticket}`]) {
    assert.equal(streamToken(new Request(`https://app${path}`)), ticket)
  }
  for (const path of ['/api/artifactPreview/file?path=C:/secret', `/api/artifactPreview/file?token=${ticket}&token=${ticket}`,
    `/api/artifactPreview/file/extra?token=${ticket}`, `/chatecnu-work/artifacts/${ticket}/other`, '/chatecnu-work/artifacts/../secret']) {
    assert.equal(streamToken(new Request(`https://app${path}`)), '')
  }
})

test('full downloads, HEAD, suffix/open ranges and changed file lengths share the Fetch response', async t => {
  const entry = await fixture(t, 200)
  const full = await fileResponse(request(), entry)
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-length'), '200')
  assert.equal(full.headers.get('cache-control'), 'private, no-store')
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(full.headers.get('content-disposition'), "inline; filename*=UTF-8''%E4%B8%AD%E6%96%87%20file.mp4")
  assert.match(full.headers.get('content-security-policy'), /sandbox/)
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), entry.bytes)
  for (const [range, start, end] of [['bytes=10-29', 10, 29], ['bytes=-15', 185, 199], ['bytes=195-', 195, 199]]) {
    const ranged = await fileResponse(request({ headers: { range } }), entry)
    assert.equal(ranged.status, 206)
    assert.equal(ranged.headers.get('content-range'), `bytes ${start}-${end}/200`)
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), entry.bytes.subarray(start, end + 1))
  }
  const head = await fileResponse(request({ method: 'HEAD', headers: { range: 'bytes=5-9' } }), entry)
  assert.equal(head.status, 206); assert.equal(head.body, null); assert.equal(head.headers.get('content-length'), '5')
  await writeFile(entry.path, 'new length')
  const changed = await fileResponse(request({ method: 'HEAD' }), { ...entry, size: 200 })
  assert.equal(changed.headers.get('content-length'), '10', 'actual descriptor size, not an old ticket size')
})

test('inline download names preserve Unicode and encode header delimiters without exposing directories', () => {
  for (const name of ['report.docx', '华师 报告 (1).pptx', `quoted";name='*().xlsx`, 'line\r\nbreak.wav']) {
    const disposition = fileDisposition(join('private-parent', 'another-folder', name))
    assert.match(disposition, /^inline; filename\*=UTF-8''[^\r\n";]*$/)
    assert.equal(decodeURIComponent(disposition.split("UTF-8''")[1]), name)
    assert.ok(!disposition.includes('private-parent'))
    assert.ok(!disposition.includes('another-folder'))
    assert.ok(!disposition.includes("'*"))
    assert.equal(new Headers({ 'Content-Disposition': disposition }).get('content-disposition'), disposition)
  }
})

test('explicit downloads use attachment while embedded media remain inline', async t => {
  const entry = await fixture(t, 128)
  const download = new Request('dsh-app://app/api/artifactPreview/file?token=test&download=1')
  const response = await fileResponse(download, entry)
  assert.match(response.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''%E4%B8%AD%E6%96%87%20file\.mp4$/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), entry.bytes)
  const head = await fileResponse(new Request(download.url, { method: 'HEAD' }), entry)
  assert.match(head.headers.get('content-disposition'), /^attachment;/)
  const inline = await fileResponse(request(), entry)
  assert.match(inline.headers.get('content-disposition'), /^inline;/)
  await inline.body.cancel()
})

test('invalid ranges and empty or deleted files close descriptors and expose no local path', async t => {
  const entry = await fixture(t, 0)
  for (const range of ['bytes=0-', 'bytes=-0', 'bytes=1-2,4-5', 'invalid']) {
    const response = await fileResponse(request({ headers: { range } }), entry)
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */0')
    assert.equal(await response.text(), '')
  }
  const empty = await fileResponse(request(), entry)
  assert.equal(empty.headers.get('content-length'), '0'); assert.equal(await empty.text(), '')
  const missing = await fileResponse(request(), { ...entry, path: `${entry.path}.missing` })
  assert.equal(missing.status, 404); assert.equal(await missing.text(), '')
})

test('Fetch reader cancel, request abort, and HEAD release the real file descriptor', async t => {
  const entry = await fixture(t, 8 * 1024 * 1024)
  for (const mode of ['reader-cancel', 'abort', 'HEAD']) {
    const controller = new AbortController()
    let descriptor, closed
    const openTracked = async (...args) => {
      descriptor = await open(...args)
      closed = once(descriptor, 'close')
      return descriptor
    }
    const response = await fileResponse(request({ method: mode === 'HEAD' ? 'HEAD' : 'GET', signal: controller.signal }), entry, openTracked)
    if (mode === 'HEAD') assert.equal(response.body, null)
    else {
      const reader = response.body.getReader()
      assert.equal((await reader.read()).done, false)
      if (mode === 'reader-cancel') await reader.cancel()
      else {
        controller.abort()
        await assert.rejects(async () => { while (!(await reader.read()).done) {} }, { name: 'AbortError' })
      }
    }
    await closed
    assert.equal(descriptor.fd, -1, `${mode} closed the actual native descriptor`)
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fileResponse(request({ signal: controller.signal }), entry), { name: 'AbortError' })
})

test('legacy HTTP client disconnect aborts the Fetch body and releases its real descriptor', async t => {
  const entry = await fixture(t, 8 * 1024 * 1024)
  let descriptor, closed
  const server = createServer((req, res) => serveLegacyStream(req, res, fetchRequest => fileResponse(fetchRequest, entry, async (...args) => {
    descriptor = await open(...args); closed = once(descriptor, 'close'); return descriptor
  })))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise((resolve, reject) => {
    const req = get(`http://127.0.0.1:${server.address().port}/file`, res => {
      res.once('data', () => { res.destroy(); resolve() })
      res.once('error', reject)
    })
    req.once('error', reject)
  })
  await closed
  assert.equal(descriptor.fd, -1)
})
