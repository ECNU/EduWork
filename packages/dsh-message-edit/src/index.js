import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Re-stage attachments of a conversation as upload receipts of a branch forked
 * from it, so the edited message can cite them. Bytes move from the attachment
 * store to the upload service inside the Host; the browser never downloads or
 * re-uploads them.
 *
 * As with the Host's own attachment reads, a stored reference is honoured
 * within the caller's access to the conversation it names. A call reads from
 * one conversation and writes to another, so access control checks both.
 */
export default class MessageEditService extends TypertRemoteService {
  static inject = ['attachments', 'fileUploads']

  constructor(ctx) {
    super(ctx, 'eduworkMessageEdit')
  }

  /** `sourceSessionId` names the conversation the attachments come from; `sessionId` the branch. */
  async stageAttachments(sourceSessionId, sessionId, attachments) {
    const { attachments: store, fileUploads } = this.ctx
    const receipts = []
    try {
      for (const { type, attachment } of attachments) {
        const staged = type === 'file'
          ? await fileUploads.uploadStream({ sessionId, name: attachment.name, data: store.readFileStream(attachment) })
          : await fileUploads.uploadImageStream({
            sessionId, mediaType: attachment.mediaType, name: attachment.name,
            data: [(await store.readImage(attachment)).data],
          })
        receipts.push(staged.receiptId)
      }
    } catch (error) {
      // Reading an image happens out here, not inside the upload service, so
      // its storage failure needs the same Remote shape the service gives.
      if (!store.isAttachmentError(error)) throw error
      throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
    }
    return receipts
  }
}

// Plain JavaScript has no decorator syntax: apply it by hand, marking the prototype once.
Remote({ name: 'stageAttachments', resources: { session: (sourceSessionId, sessionId) => [sourceSessionId, sessionId] } })(
  MessageEditService.prototype.stageAttachments,
  { kind: 'method', name: 'stageAttachments', static: false, private: false, addInitializer: initialize => initialize.call(Object.create(MessageEditService.prototype)) },
)
