import { observeComposition } from '@deepseek-ai/dsh-client-ui-primitives'
import { REMOTE } from '../remote.js'
import { EditDrafts } from './drafts.js'
import { forkBoundary } from './fork-boundary.js'
import { restoreMentions } from './mentions.js'
import { MessageEditSeat } from './editor.jsx'
import { SteeringPencils } from './steering.jsx'

const NS = 'eduworkMessageEdit'
const COPY = {
  zh: {
    edit: '编辑消息', running: '对话进行中，结束后可编辑',
    cancel: '取消', send: '发送', attach: '添加文件或图片',
    remove: '移除 {name}', retry: '重试上传 {name}', image: '图片', file: '文件',
    hint: '发送后用改过的对话替换当前对话，原对话移入归档；已做的文件修改不会撤销',
    uploading: '上传中…', uploadFailed: '上传失败，点击重试',
    uploadingHold: '附件还在上传，上传完成后才能发送',
    othersSending: '这个对话里另一条编辑正在发送，发送完成后再发',
    folder: '不能添加文件夹，请添加单个文件',
    tooMany: '一条消息最多添加 {count} 张图片', imageTooLarge: '单张图片不能超过 {size}', imagesTooLarge: '图片总大小超过 {size}，请移除部分图片',
    modelUnsupported: '当前模型不支持图片，请切换支持图片的模型', tooManyPixels: '图片分辨率过大，请压缩后重试',
    dimensionTooLarge: '图片宽高不能超过 {size}px，请缩小后重试', unsupportedType: '仅支持 PNG、JPG、WebP、GIF 格式的图片',
    attachmentRefused: '附件无法发送（{reason}）',
    attachmentMissing: '原消息的附件已找不到，请移除后再发送',
    branchFailed: '已创建分支对话，但消息没有发出：{message}',
    unconfirmed: '已创建分支对话，但连接中断，无法确认消息是否发出，请到侧栏的分支对话里查看',
    historyFailed: '没能加载这条消息之前的记录，请稍后重试',
    references: '引用会话 · {labels}', listSeparator: '、',
    steering: '插话不能单独编辑，请编辑这一轮开头的消息',
    steers: '这一轮还有 {count} 条插话，发送后会一起替换',
  },
  en: {
    edit: 'Edit message', running: 'Available when the conversation finishes',
    cancel: 'Cancel', send: 'Send', attach: 'Add files or images',
    remove: 'Remove {name}', retry: 'Retry uploading {name}', image: 'Image', file: 'File',
    hint: 'Sending replaces this conversation with the edited one and archives the original; file changes are not undone',
    uploading: 'Uploading…', uploadFailed: 'Upload failed; click to retry',
    uploadingHold: 'Attachments are still uploading; send after they finish',
    othersSending: 'Another edit of this conversation is being sent; send after it finishes',
    folder: 'Folders cannot be added; add individual files',
    tooMany: 'A message can include up to {count} images', imageTooLarge: 'Each image must be smaller than {size}', imagesTooLarge: 'Images exceed {size} in total; remove some',
    modelUnsupported: 'The current model does not support images; switch to a model that does', tooManyPixels: 'Image resolution is too high; compress it and try again',
    dimensionTooLarge: 'Image sides must be at most {size}px; downscale it and try again', unsupportedType: 'Only PNG, JPG, WebP, and GIF images are supported',
    attachmentRefused: 'The attachment cannot be sent ({reason})',
    attachmentMissing: 'An attachment of the original message is gone; remove it and send again',
    branchFailed: 'A branch was created, but the message was not sent: {message}',
    unconfirmed: 'A branch was created, but the connection dropped before the send was confirmed; check the branch in the sidebar',
    historyFailed: 'Could not load the history before this message; try again later',
    references: 'Referenced conversations · {labels}', listSeparator: ', ',
    steering: 'Messages sent mid-reply cannot be edited on their own; edit the message that started this turn',
    steers: 'This turn has {count} more message(s) sent mid-reply; sending replaces them too',
  },
}

const CSS = `
/* The slot wraps this seat in a display:contents element; hide the bubble and
   action row that follow it while the message is being edited. */
[data-slot="conversation.chat.user.before"]:has([data-eduwork-message-editor]) ~ * { display: none !important; }
.eduwork-message-editor { align-self: stretch; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
  border-radius: 16px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.eduwork-message-editor[data-drop-active] { border-color: var(--dsw-alias-brand-primary, #4d6bfe); background: var(--dsw-alias-interactive-bg-hover); }
.eduwork-message-editor textarea { width: 100%; box-sizing: border-box; resize: none; border: 0; outline: 0; padding: 0;
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit;
  font-size: calc(14px + var(--dsh-content-font-delta, 0px)); line-height: 1.6; max-height: 50vh; overflow: auto; }
.eduwork-message-editor-attachments { display: flex; flex-wrap: wrap; gap: 8px; }
.eduwork-message-editor-attachment { position: relative; box-sizing: border-box; height: 64px; border-radius: var(--dsw-radius-lg, 12px);
  border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-input-major, transparent); overflow: hidden; }
.eduwork-message-editor-attachment[data-state="failed"], .eduwork-message-editor-attachment[data-state="refused"] { border-color: var(--dsw-alias-state-error-primary, #d54941); }
.eduwork-message-editor-attachment[data-kind="image"] { width: 64px; }
.eduwork-message-editor-image, .eduwork-message-editor-image img { width: 100%; height: 100%; display: block; }
.eduwork-message-editor-image img { object-fit: cover; }
.eduwork-message-editor-image > svg { display: block; margin: 22px auto; color: var(--dsw-alias-state-error-primary, #d54941); }
.eduwork-message-editor-attachment:is([data-state="uploading"], [data-state="failed"], [data-state="refused"]) img { opacity: .4; }
.eduwork-message-editor-attachment[data-kind="file"] { width: 240px; display: flex; align-items: center; gap: 10px; padding: 0 12px; }
.eduwork-message-editor-file-icon { flex: none; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; }
.eduwork-message-editor-spinner { width: 20px; height: 20px; box-sizing: border-box; border: 2px solid; border-top-color: transparent; border-radius: 50%;
  animation: eduwork-message-editor-spin .8s linear infinite; }
@keyframes eduwork-message-editor-spin { to { transform: rotate(360deg); } }
.eduwork-message-editor-file-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
[data-state="failed"] :is(.eduwork-message-editor-file-body, .eduwork-message-editor-image) { cursor: pointer; }
.eduwork-message-editor-file-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-primary);
  font-size: 14px; font-weight: 500; line-height: 22px; }
.eduwork-message-editor-file-meta { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 15px; }
:is([data-state="failed"], [data-state="refused"]) .eduwork-message-editor-file-meta { color: var(--dsw-alias-state-error-primary, #d54941); }
.eduwork-message-editor-progress { position: absolute; left: 8px; right: 8px; bottom: 5px; height: 2px; border-radius: 1px; overflow: hidden;
  pointer-events: none; background: var(--dsw-alias-fill-tertiary, #00000014); }
.eduwork-message-editor-progress > span { display: block; height: 100%; width: 35%; border-radius: inherit; background: var(--dsw-alias-brand-primary, #4d6bfe);
  animation: eduwork-message-editor-indeterminate 1.2s ease-in-out infinite alternate; }
@keyframes eduwork-message-editor-indeterminate { from { margin-left: 0; } to { margin-left: 65%; } }
.eduwork-message-editor .eduwork-message-editor-remove { position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; min-height: 0; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; opacity: 0; transition: opacity .2s ease-in-out;
  color: var(--dsw-alias-label-primary-inverted, #fff); background: var(--dsw-alias-button-contrast-fill, #000000b8); }
.eduwork-message-editor .eduwork-message-editor-remove:hover:not(:disabled) { background: var(--dsw-alias-button-contrast-fill, #000000b8); }
.eduwork-message-editor-attachment:is(:hover, :focus-within, [data-state="failed"], [data-state="refused"]) .eduwork-message-editor-remove { opacity: 1; }
@media (hover: none), (pointer: coarse) { .eduwork-message-editor .eduwork-message-editor-remove { opacity: 1; } }
.eduwork-message-editor-references, .eduwork-message-editor-steers { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.eduwork-message-editor-foot { display: flex; align-items: center; gap: 8px; }
.eduwork-message-editor .eduwork-message-editor-attach { padding: 0; width: 28px; display: inline-flex; align-items: center; justify-content: center; }
.eduwork-message-editor-note { flex: 1; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.eduwork-message-editor-note[data-error] { color: var(--dsw-alias-state-error-primary, #d54941); }
.eduwork-message-editor button { min-height: 28px; padding: 4px 12px; border: 0; border-radius: 8px; font: inherit; font-size: 13px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent; }
.eduwork-message-editor button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.eduwork-message-editor button[data-primary] { color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); }
.eduwork-message-editor button[data-primary]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.eduwork-message-editor button:disabled { opacity: .5; cursor: not-allowed; }
`

/** An error the editor shows with one of its own messages. */
const failure = (copy, extra = {}) => Object.assign(new Error(copy), { copy, ...extra })

/** A Host refusal; an attachment refusal keeps its reason for display. */
const refusal = error => Object.assign(new Error(error.message), { reason: error.details?.reason })

async function unwrap(operation) {
  const result = await operation
  if (result.ok) return result.value
  throw refusal(result.error)
}

/**
 * The branch a failed fork left behind: the Host can create the child and then
 * fail to file it in the workspace, in which case `onCreated` never ran.
 */
const strandedChild = error => (error?.name === 'SessionForkError' && error.rpcError.code === 'session/workspace-attach-failed' ? error.rpcError.details.sessionId : undefined)

/**
 * Durable events of a Session from `seq` on. `loadThrough` returns early while
 * a plain page load is in flight and fails soft, so wait that load out and
 * confirm the window really reaches `seq`.
 */
async function historyFrom(session, seq) {
  for (;;) {
    await session.loadThrough(seq)
    const events = session.eventSource.getSnapshot().entries.filter(entry => entry.type === 'event').map(entry => entry.event)
    const { hasMore, loadingOlder } = session.getSnapshot()
    if (!hasMore || events[0]?.seq <= seq) return events
    if (!loadingOlder) throw failure('historyFailed')
    await new Promise(resolve => {
      const stop = session.subscribe(() => {
        if (!session.getSnapshot().loadingOlder) { stop(); resolve() }
      })
    })
  }
}

export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'uiWorkspace', 'remote', 'fileUpload']

export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(REMOTE)
  ctx.effect(() => ctx.locale.register(NS, COPY), 'message-edit: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.eduworkMessageEditStyle = ''
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  }, 'message-edit: styles')
  const composition = observeComposition(document)
  ctx.effect(() => () => composition.dispose(), 'message-edit: composition guard')

  ctx.inject(['remote.eduworkMessageEdit'], surface => {
    const drafts = new EditDrafts(surface.fileUpload)
    surface.effect(() => () => drafts.dispose(), 'message-edit: drafts')
    const readImage = (sessionId, ref) => surface.sessions.binding(sessionId).session.readAttachment(ref)
    const isSubagent = sessionId => surface.sessions.subagentAddress(sessionId) !== undefined
    // The Host files a message's referenced conversations as the event right
    // after it, which the loaded window holds whenever the message is shown.
    const referencesOf = (sessionId, seq) => {
      const next = surface.sessions.binding(sessionId).session.eventSource.getSnapshot().entries
        .find(entry => entry.type === 'event' && entry.event.seq === seq + 1)?.event
      return next?.type === 'user/message' && next.data.source?.kind === 'session-reference' ? next.data.source.references : []
    }
    const using = (sessionId, operation) => surface.sessions.using(sessionId, { source: 'eduworkMessageEdit' }, async reference => {
      await reference.ready
      return operation(reference.binding.session)
    })

    // Fork just before the edited message's Turn and send the edited message as
    // the branch's next Turn. As editing does in Codex, the branch then takes
    // the conversation's place: it keeps the title and pin, and the original
    // is archived, unchanged and recoverable from the archive.
    async function resend({ sessionId, turnStart, previousEnd, kept, added, text, mentions }) {
      // Every attachment is a stored reference by now: the message's own, or
      // one the edit uploaded to this Session. Like the native composer, the
      // message carries its attachments first and the text after them.
      const attachments = [...kept, ...added.map(item => ({ type: item.kind, attachment: item.upload.ref }))]
      let childId
      let userTitle
      try {
        // Hold the source while its history loads: the user may leave it meanwhile.
        await using(sessionId, async source => {
          const events = await historyFrom(source, previousEnd ?? 0)
          const atSeq = forkBoundary(events, turnStart)
          if (atSeq < 0) throw failure('historyFailed')
          // The branch inherits every title set before the cut. A title the user
          // set after it is carried over; a generated one is left to regenerate,
          // since renaming would pin it and stop automatic titles.
          const title = events.findLast(event => event.type === 'session/title')
          if (title?.seq > atSeq && title.data.source.kind === 'user') userTitle = title.data.title
          // `onCreated` names the child before the title rename that may still fail.
          await surface.sessions.fork({ sessionId, atSeq, increaseTitle: false, onCreated: id => { childId = id } })
        })
        await using(childId, async child => {
          if (userTitle !== undefined) await unwrap(child.rename(userTitle))
          // Input queued while an earlier Turn ran is part of the inherited prefix;
          // the edited message replaces it, so drop it before anything wakes the
          // branch. Removal alone does not start a Turn.
          const inbox = child.projections.get('inbox')
          for (const item of [...inbox?.['next-turn'] ?? [], ...inbox?.['next-step'] ?? []]) await unwrap(child.updateQueue(item.id, { kind: 'remove' }))
          const receipts = attachments.length === 0 ? [] : await unwrap(surface.remote.eduworkMessageEdit.stageAttachments(sessionId, childId, attachments))
          const content = receipts.map(receiptId => ({ type: 'file', receiptId }))
          if (text.trim() !== '') content.push({ type: 'text', text: restoreMentions(text, mentions) })
          // Only a Host reply proves the prompt was refused; a throw or a lost
          // connection leaves it unknown, and that branch may already be running.
          const result = await child.prompt(content, 'queue').catch(() => ({ ok: false, error: { code: 'connection/unknown' } }))
          if (!result.ok) throw result.error.code.startsWith('connection/') ? failure('unconfirmed', { branch: childId }) : refusal(result.error)
        })
      } catch (cause) {
        childId ??= strandedChild(cause)
        const error = cause instanceof Error ? cause : new Error(String(cause))
        // A refused send leaves the branch holding only copied history: archive
        // it rather than leave an empty conversation behind, and say so if that
        // fails too.
        if (childId !== undefined && error.branch === undefined) await surface.uiWorkspace.archiveSession(childId).catch(() => { error.branch = childId })
        throw error
      }
      // Whoever opens the original until it is archived lands on its
      // replacement instead: archiving clears the selection, which would leave
      // them on an empty page. The send already succeeded, so a failed pin or
      // archive only leaves the original listed.
      const view = surface.sessions.retainInfo(sessionId)
      let wasViewing = false
      let asked = false
      const follow = () => {
        const viewing = Boolean(view.getSnapshot().retainedBy.mainView)
        if (viewing && !wasViewing) asked = true
        wasViewing = viewing
      }
      follow()
      const stopFollowing = view.subscribe(follow)
      try {
        if (surface.workspaces.list.getSnapshot().pinnedSessionIds.includes(sessionId)) await surface.uiWorkspace.pinSession(childId).catch(() => {})
        drafts.moveSession(sessionId, childId, turnStart)
        if (asked) {
          asked = false
          // Leave the original only once it has finished opening: a Session
          // left before it renders is dropped mid-opening.
          await using(sessionId, () => {}).catch(() => {})
          surface.uiWorkspace.openSession(childId)
        }
        await surface.uiWorkspace.archiveSession(sessionId).catch(() => {})
      } finally {
        stopFollowing()
      }
      // Opened while being archived: the original is gone, so show its replacement.
      if (asked) surface.uiWorkspace.openSession(childId)
    }

    // A chain seat elects one occupant; the lowest precedence lets any future
    // message-source decoration win over this invisible seat.
    surface.slots.inject('conversation.chat.user.before', () => surface.slots.register({
      name: 'conversation.chat.user.before', id: 'eduwork-message-edit', priority: 1000, locale: NS,
      select: owner => (owner.kind === 'user' ? true : null),
      inject: () => ({ drafts, resend, readImage, referencesOf, isSubagent, composing: event => composition.guards(event) }),
    }, MessageEditSeat))
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'eduwork-message-edit.steering', locale: NS }, SteeringPencils))

  return async () => { await disposeRemote() }
}
