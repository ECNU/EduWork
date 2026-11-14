import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileTypeIcon, IconCloseFillRegular, IconEditOutlineRegular, IconPaperclipOutlineRegular, IconWarningOutlineRegular, fileExtension, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import { useDraft, useSendingIn } from './drafts.js'
import { locateMentions } from './mentions.js'

const h = React.createElement

const isAttachment = block => block.type === 'image' || block.type === 'file'

/** An image the stored message carries, loaded through the Session for display only. */
function StoredImage({ attachment, readImage }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let current = null
    let live = true
    void readImage(attachment).then(read => {
      if (!live || !read.ok) return
      current = URL.createObjectURL(new Blob([read.value.data], { type: attachment.mediaType }))
      setUrl(current)
    })
    return () => { live = false; if (current) URL.revokeObjectURL(current) }
  }, [attachment, readImage])
  return url && h('img', { src: url, alt: attachment.name ?? '' })
}

/**
 * One attachment in the editor, drawn like the native draft rail: a 64px image
 * square or a 240px file card. `state` is ready, uploading (with `progress`
 * in 0–1 when known), failed (retryable), or refused (only removable).
 */
function Chip({ kind, name, bytes, image, state, progress, problem, labels, disabled, onRemove, onRetry }) {
  const failed = state === 'failed' || state === 'refused'
  const progressBar = state === 'uploading' && h('span', { className: 'eduwork-message-editor-progress', 'aria-hidden': true },
    h('span', { style: progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%`, animation: 'none' } }))
  const remove = h('button', { type: 'button', className: 'eduwork-message-editor-remove', 'aria-label': labels.remove, onClick: onRemove, disabled },
    h(IconCloseFillRegular, { size: 12 }))
  const retry = state === 'failed' && !disabled ? { role: 'button', tabIndex: 0, 'aria-label': labels.retry, onClick: onRetry, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRetry() } } } : {}
  const attributes = { className: 'eduwork-message-editor-attachment', 'data-kind': kind, 'data-state': state, title: failed ? problem : name }
  if (kind === 'image') return h('div', attributes, h('div', { className: 'eduwork-message-editor-image', ...retry }, failed ? h(IconWarningOutlineRegular, { size: 20 }) : image), progressBar, remove)
  const meta = state === 'uploading' ? labels.uploading : failed ? problem : [fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(bytes)].filter(Boolean).join(' ')
  return h('div', attributes,
    h('span', { className: 'eduwork-message-editor-file-icon', 'aria-hidden': true },
      state === 'uploading' ? h('span', { className: 'eduwork-message-editor-spinner' }) : h(FileTypeIcon, { path: name })),
    h('span', { className: 'eduwork-message-editor-file-body', ...retry },
      h('span', { className: 'eduwork-message-editor-file-name' }, name),
      h('span', { className: 'eduwork-message-editor-file-meta' }, meta)),
    progressBar, remove)
}

/** Text for a Host attachment refusal, matching the native composer's wording. */
export function refusalText(t, reason, limits) {
  switch (reason) {
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return t('modelUnsupported')
    case 'ATTACHMENT_NOT_FOUND': return t('attachmentMissing')
    case 'IMAGE_TOO_MANY_PIXELS': return t('tooManyPixels')
    case 'IMAGE_DIMENSION_TOO_LARGE': return limits ? t('dimensionTooLarge', { size: limits.maxImageDimension }) : t('attachmentRefused', { reason })
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH': return t('unsupportedType')
    case 'TOO_MANY_IMAGES': return limits ? t('tooMany', { count: limits.maxImagesPerMessage }) : t('attachmentRefused', { reason })
    case 'IMAGE_TOO_LARGE': return limits ? t('imageTooLarge', { size: fileSizeText(limits.maxImageBytes) }) : t('attachmentRefused', { reason })
    case 'IMAGES_TOO_LARGE': return limits ? t('imagesTooLarge', { size: fileSizeText(limits.maxMessageImageBytes) }) : t('attachmentRefused', { reason })
    default: return t('attachmentRefused', { reason })
  }
}

/** Files carried by a paste or drop, with the members that are directories. */
function transferFiles(items) {
  const files = []
  const directories = new Set()
  for (const item of items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file === null) continue
    files.push(file)
    if (item.webkitGetAsEntry?.()?.isDirectory === true) directories.add(file)
  }
  return { files, directories }
}

const carriesFiles = event => event.dataTransfer?.types.includes('Files') === true

export function MessageEditSeat({ useChat, useSession, useAccess, useProjection, sessionId, drafts, resend, readImage, referencesOf, isSubagent, composing, t }) {
  const anchor = useRef(null)
  const textarea = useRef(null)
  const picker = useRef(null)
  const lastInput = useRef(null)
  const dragDepth = useRef(0)
  const [host, setHost] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  useLayoutEffect(() => {
    // The user row owns no action slot; its node seat and native action row
    // are the anchors. This seat renders inside the same row, so both exist
    // by the time layout effects run.
    const seat = anchor.current?.closest('[data-chat-node-key]')
    const actions = seat?.querySelector('[data-clock]')
    if (seat && actions) setHost({ key: seat.getAttribute('data-chat-node-key'), actions })
  }, [])
  const node = useChat(snapshot => (host ? snapshot.nodes.get(host.key) : undefined))
  const message = node?.kind === 'user' ? node.data : undefined
  const key = message && `${sessionId}\u0000${message.messageId ?? host.key}`
  const draft = useDraft(drafts, key)
  const sessionSending = useSendingIn(drafts, sessionId)
  const editing = draft !== undefined
  useLayoutEffect(() => {
    // Open, or come back into view, with the caret after the text.
    const field = textarea.current
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [editing])
  useEffect(() => {
    // React's onBeforeInput reports typed text only; the native event also
    // names deletions, which mention tracking needs.
    const field = textarea.current
    if (!field) return
    const record = event => { lastInput.current = { inputType: event.inputType, start: field.selectionStart, end: field.selectionEnd } }
    // An input that leaves the value as it was, such as pasting a mention's
    // own text over it, still replaced what it selected, but React reports
    // no change for it.
    const unchanged = () => {
      if (field.value !== drafts.get(key)?.text) return
      drafts.setText(key, field.value, lastInput.current)
      lastInput.current = null
    }
    field.addEventListener('beforeinput', record)
    field.addEventListener('input', unchanged)
    return () => {
      field.removeEventListener('beforeinput', record)
      field.removeEventListener('input', unchanged)
    }
  }, [editing, drafts, key])
  useLayoutEffect(() => {
    const field = textarea.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [draft?.text])
  const running = useSession(session => session.running)
  const canFork = useAccess('session/fork')
  const canPrompt = useAccess('session/prompt')
  const canUpload = useAccess('fileUploads/upload') !== false
  const limits = useProjection('imageLimits')
  const readSessionImage = useCallback(ref => readImage(sessionId, ref), [readImage, sessionId])
  // The edited message opens its Turn; the branch keeps everything before that
  // Turn, so the previous Turn's end is the earliest history the cut needs.
  const turn = node?.location?.turn
  const previousEnd = useChat(snapshot => (turn ? snapshot.timeline.turns.get(turn.turn - 1)?.end?.seq : undefined))
  // Messages steered into the Turn go with it when the edit replaces it.
  const steers = useChat(snapshot => (editing && turn ? snapshot.locations.getTurn(turn.turn).filter(nodeKey => snapshot.nodes.get(nodeKey)?.kind === 'steering').length : 0))
  if (!message || !canFork || !canPrompt || isSubagent(sessionId) || !Number.isSafeInteger(turn?.start?.seq)) return h('span', { ref: anchor, hidden: true })

  const blocks = message.content
  const start = () => {
    const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
    drafts.open(key, message.seq, text, locateMentions(text, referencesOf(sessionId, message.seq)))
  }
  const pencil = createPortal(h('button', {
    type: 'button', className: host.actions.querySelector('button:not([data-eduwork-message-edit])')?.className, 'data-eduwork-message-edit': '',
    'aria-label': t('edit'), title: running ? t('running') : t('edit'), 'aria-disabled': running || undefined, 'data-unavailable': running || undefined,
    onClick: running ? undefined : start,
  }, h(IconEditOutlineRegular, {})), host.actions)
  if (!editing) return h(React.Fragment, null, h('span', { ref: anchor, hidden: true }), pencil)

  const { text, mentions, removed, added, sending, notice } = draft
  const kept = blocks.map((block, index) => [block, index]).filter(([block, index]) => isAttachment(block) && !removed.has(index))
  const uploading = added.some(item => item.upload?.status === 'uploading')
  const failed = added.find(item => item.upload?.status === 'error')?.upload
  const empty = text.trim() === '' && kept.length === 0 && added.length === 0
  const canAdd = canUpload && !sending
  const othersSending = sessionSending && !sending
  const blocked = sending || othersSending || empty || uploading || failed

  const cancel = () => { if (!sending) drafts.close(key) }
  const send = async () => {
    if (blocked || !drafts.startSending(key, sessionId)) return
    try {
      await resend({ sessionId, turnStart: turn.start.seq, previousEnd, kept: kept.map(([block]) => block), added, text, mentions })
      drafts.close(key)
    } catch (cause) {
      const reason = cause?.copy ? t(cause.copy) : cause?.reason !== undefined ? refusalText(t, cause.reason, limits) : cause instanceof Error ? cause.message : String(cause)
      drafts.update(key, () => ({ sending: false, notice: cause?.branch && !cause.copy ? t('branchFailed', { message: reason }) : reason }))
    }
  }
  const intake = (files, directories) => {
    if (!canAdd || files.length === 0) return
    const refusal = drafts.addFiles(key, sessionId, files, {
      directories, limits, keptImageBytes: kept.filter(([block]) => block.type === 'image').map(([block]) => block.attachment.bytes),
    })
    if (refusal) {
      const [copy, values] = refusal
      drafts.update(key, () => ({ notice: t(copy, values.bytes === undefined ? values : { size: fileSizeText(values.bytes) }) }))
    }
    textarea.current?.focus()
  }
  // Drags carrying files stop here so the composer's document-level drop
  // target neither shows its overlay over the editor nor takes the files.
  const drop = {
    onDragEnter: event => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepth.current++
      setDragOver(true)
    },
    onDragOver: event => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = canAdd ? 'copy' : 'none'
    },
    onDragLeave: event => {
      if (!carriesFiles(event)) return
      event.stopPropagation()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    },
    onDrop: event => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepth.current = 0
      setDragOver(false)
      const { files, directories } = transferFiles(event.dataTransfer.items)
      intake(files, directories)
    },
  }
  const labels = name => ({ remove: t('remove', { name }), retry: t('retry', { name }), uploading: t('uploading') })
  // Like the native composer, a failed upload holds the send and says why.
  const status = notice ?? (failed ? (failed.reason ? refusalText(t, failed.reason, limits) : t('uploadFailed')) : uploading ? t('uploadingHold') : othersSending ? t('othersSending') : t('hint'))

  return h(React.Fragment, null,
    h('span', { ref: anchor, hidden: true }),
    pencil,
    h('div', { className: 'eduwork-message-editor', 'data-eduwork-message-editor': '', 'data-drop-active': dragOver || undefined, ...drop },
      kept.length + added.length > 0 && h('div', { className: 'eduwork-message-editor-attachments' },
        kept.map(([block, index]) => h(Chip, {
          key: `original-${index}`, kind: block.type, state: 'ready',
          name: block.attachment.name ?? t('image'), bytes: block.attachment.bytes,
          image: block.type === 'image' && h(StoredImage, { attachment: block.attachment, readImage: readSessionImage }),
          labels: labels(block.attachment.name ?? t('image')), disabled: sending,
          onRemove: () => { drafts.removeOriginal(key, index); textarea.current?.focus() },
        })),
        added.map(item => {
          const upload = item.upload
          const state = upload?.status === 'ready' ? 'ready' : upload?.status === 'error' ? (upload.reason ? 'refused' : 'failed') : 'uploading'
          const name = item.file.name || t(item.kind === 'image' ? 'image' : 'file')
          return h(Chip, {
            key: item.id, kind: item.kind, state, name, bytes: item.file.size,
            image: item.kind === 'image' && h('img', { src: item.previewUrl, alt: name }),
            progress: upload?.status === 'uploading' && upload.total ? upload.loaded / upload.total : undefined,
            problem: upload?.status !== 'error' ? undefined : upload.reason ? refusalText(t, upload.reason, limits) : t('uploadFailed'),
            labels: labels(name), disabled: sending,
            onRemove: () => { drafts.removeAdded(key, item.id); textarea.current?.focus() },
            onRetry: () => drafts.retry(key, sessionId, item.id),
          })
        })),
      h('textarea', {
        ref: textarea, value: text, rows: 1, autoFocus: true, disabled: sending,
        'aria-label': t('edit'),
        onChange: event => {
          drafts.setText(key, event.currentTarget.value, lastInput.current)
          lastInput.current = null
        },
        onPaste: event => {
          const { files, directories } = transferFiles(event.clipboardData.items)
          if (files.length === 0) return
          intake(files, directories)
          // Text riding along with the files (a file name, say) still pastes.
          if (event.clipboardData.getData('text/plain') === '') event.preventDefault()
        },
        onKeyDown: event => {
          // Shift+Enter is a newline; keys that confirm or dismiss an
          // input-method candidate are not ours.
          if (event.key !== 'Escape' && (event.key !== 'Enter' || event.shiftKey) || composing(event.nativeEvent)) return
          event.preventDefault()
          if (event.key === 'Escape') cancel()
          else if (!event.repeat) void send()
        },
      }),
      // Like the sent message, name the conversations it will reference.
      mentions.length > 0 && h('div', { className: 'eduwork-message-editor-references' },
        t('references', { labels: mentions.map(mention => mention.label).join(t('listSeparator')) })),
      steers > 0 && h('div', { className: 'eduwork-message-editor-steers' }, t('steers', { count: steers })),
      h('div', { className: 'eduwork-message-editor-foot' },
        canUpload && h('button', {
          type: 'button', className: 'eduwork-message-editor-attach', 'aria-label': t('attach'), title: t('attach'),
          disabled: sending, onClick: () => picker.current?.click(),
        }, h(IconPaperclipOutlineRegular, { size: 16 })),
        canUpload && h('input', {
          ref: picker, type: 'file', multiple: true, hidden: true,
          onChange: event => {
            const files = [...event.currentTarget.files ?? []]
            event.currentTarget.value = ''
            intake(files)
          },
        }),
        h('span', { className: 'eduwork-message-editor-note', 'data-error': notice !== null || failed !== undefined || undefined, role: notice === null ? undefined : 'alert' }, status),
        h('button', { type: 'button', onClick: cancel, disabled: sending }, t('cancel')),
        h('button', { type: 'button', 'data-primary': '', onClick: () => void send(), disabled: blocked }, t('send')))))
}
