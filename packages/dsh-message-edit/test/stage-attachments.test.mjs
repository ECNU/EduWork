import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import MessageEditService from '../lib/index.js'
import { REMOTE } from '../src/remote.js'

const image = { type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'a.png' } }
const file = { type: 'file', attachment: { attachmentId: 'sha256:bb', name: 'b.txt', bytes: 2 } }

function fakeCtx({ readImage } = {}) {
  const calls = []
  const read = []
  const storeError = Object.assign(new Error('gone'), { code: 'ATTACHMENT_NOT_FOUND', attachment: true })
  return {
    calls, read, storeError,
    attachments: {
      readImage: readImage ?? (async ref => { read.push(ref); return { data: new Uint8Array([1, 2, 3]) } }),
      readFileStream: async function* (ref) { read.push(ref); yield new Uint8Array([4, 5]) },
      isAttachmentError: error => error?.attachment === true,
    },
    fileUploads: {
      uploadStream: async request => { for await (const chunk of request.data) void chunk; calls.push(['file', request.sessionId, request.name]); return { receiptId: `r${calls.length}` } },
      uploadImageStream: async request => { calls.push(['image', request.sessionId, request.mediaType]); return { receiptId: `r${calls.length}` } },
    },
  }
}
const stage = (ctx, attachments) => MessageEditService.prototype.stageAttachments.call({ ctx }, 'session-source', 'session-branch', attachments)

test('stages images and files into the branch in order', async () => {
  const ctx = fakeCtx()
  assert.deepEqual(await stage(ctx, [image, file]), ['r1', 'r2'])
  assert.deepEqual(ctx.calls, [['image', 'session-branch', 'image/png'], ['file', 'session-branch', 'b.txt']])
})

test('access control sees both conversations the call touches', () => {
  const [marker] = remoteMethods(Object.create(MessageEditService.prototype))
  assert.equal(marker.method, 'stageAttachments')
  assert.deepEqual(marker.resources.session('session-source', 'session-branch', []), ['session-source', 'session-branch'])
})

test('a stored image that cannot be read becomes an attachment refusal with its reason', async () => {
  const ctx = fakeCtx({ readImage: async () => { throw ctx.storeError } })
  await assert.rejects(stage(ctx, [image]), error => error.code === 'session/attachment-invalid' && error.details.reason === 'ATTACHMENT_NOT_FOUND')
})

test('other failures pass through unchanged', async () => {
  const boom = new Error('boom')
  const ctx = fakeCtx({ readImage: async () => { throw boom } })
  await assert.rejects(stage(ctx, [image]), error => error === boom)
})

test('a stored reference reaches the store with fields this plugin does not read', async () => {
  const input = REMOTE.methods['eduworkMessageEdit/stageAttachments'].input({ strict: true }).create()
  const later = [image, file].map(block => ({ ...block, attachment: { ...block.attachment, later: true } }))
  const { attachments } = input.parse({ sourceSessionId: 'session-source', sessionId: 'session-branch', attachments: later })
  const ctx = fakeCtx()
  await stage(ctx, attachments)
  assert.deepEqual(ctx.read, later.map(block => block.attachment))
})
