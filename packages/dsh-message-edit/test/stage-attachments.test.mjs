import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import MessageEditService from '../lib/index.js'

const image = { type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'a.png' } }
const file = { type: 'file', attachment: { attachmentId: 'sha256:bb', name: 'b.txt', bytes: 2 } }

function fakeCtx({ readImage } = {}) {
  const calls = []
  const storeError = Object.assign(new Error('gone'), { code: 'ATTACHMENT_NOT_FOUND', attachment: true })
  return {
    calls, storeError,
    attachments: {
      readImage: readImage ?? (async () => ({ data: new Uint8Array([1, 2, 3]) })),
      readFileStream: async function* () { yield new Uint8Array([4, 5]) },
      isAttachmentError: error => error?.attachment === true,
    },
    fileUploads: {
      uploadStream: async request => { calls.push(['file', request.sessionId, request.name]); return { receiptId: `r${calls.length}` } },
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
