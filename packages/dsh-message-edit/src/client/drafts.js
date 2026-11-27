import { useSyncExternalStore } from 'react'
import { followEdit } from './mentions.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
// The native composer's default upload concurrency.
const CONCURRENT_UPLOADS = 2

/**
 * Open message edits, kept outside React: the chat list virtualizes its rows,
 * so a row scrolled out of view unmounts, and the user may switch Sessions and
 * come back. A draft, its uploads, and a send in flight survive both.
 *
 * Files added while editing upload to the Session being edited as soon as they
 * are added, exactly as the native composer uploads its drafts. The Host thus
 * validates them before any branch exists, and sending re-stages the stored
 * attachments into the branch like the message's original ones.
 */
export class EditDrafts {
  #drafts = new Map()
  #listeners = new Set()
  #queue = []
  #active = 0
  #nextId = 0

  constructor(fileUpload) {
    this.fileUpload = fileUpload
  }

  subscribe = listener => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get = key => this.#drafts.get(key)

  /**
   * Whether an edit of the Session is being sent. A sent edit replaces the
   * Session, so its other edits wait for that rather than branch from a
   * conversation about to be archived.
   */
  sendingIn = sessionId => [...this.#drafts].some(([key, draft]) => draft.sending && key.startsWith(`${sessionId}\u0000`))

  /** Claim the Session's one send for this draft; false when another holds it. */
  startSending(key, sessionId) {
    if (!this.#editable(key) || this.sendingIn(sessionId)) return false
    this.update(key, () => ({ sending: true, notice: null }))
    return true
  }

  /**
   * Open a draft of the message at `seq`; `mentions` are the referenced
   * conversations its text cites.
   */
  open(key, seq, text, mentions) {
    this.#set(key, { seq, text, mentions, removed: new Set(), added: [], sending: false, notice: null })
  }

  /** Close a draft, cancelling its uploads and releasing its previews. */
  close(key) {
    for (const item of this.#drafts.get(key)?.added ?? []) {
      item.controller?.abort()
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }
    this.#set(key, undefined)
  }

  /** Drop every draft when the plugin goes away. */
  dispose() {
    this.#queue.length = 0
    for (const key of [...this.#drafts.keys()]) this.close(key)
    this.#listeners.clear()
  }

  /**
   * Hand a replaced Session's drafts to its replacement. A draft of a message
   * before `seq` moves along, uploads and all, since the replacement inherited
   * that message under the same id; the rest edit messages the replacement
   * lacks and close. The draft being sent closes on its own.
   */
  moveSession(from, to, seq) {
    for (const [key, draft] of [...this.#drafts]) {
      if (!key.startsWith(`${from}\u0000`) || draft.sending) continue
      if (draft.seq >= seq) {
        this.close(key)
        continue
      }
      this.#drafts.delete(key)
      this.#set(`${to}${key.slice(from.length)}`, draft)
    }
  }

  update(key, change) {
    const draft = this.#drafts.get(key)
    if (draft) this.#set(key, { ...draft, ...change(draft) })
  }

  /** Take the textarea's new value; `edit` is the input the textarea announced for it. */
  setText(key, text, edit) {
    this.update(key, draft => ({ text, mentions: followEdit(draft.mentions, draft.text, text, edit), notice: null }))
  }

  // While a send is in flight its content is fixed: the edits below wait.
  #editable = key => this.#drafts.get(key)?.sending === false

  removeOriginal(key, index) {
    if (!this.#editable(key)) return
    this.update(key, draft => ({ removed: new Set(draft.removed).add(index), notice: null }))
  }

  removeAdded(key, id) {
    const item = this.#editable(key) && this.#drafts.get(key).added.find(candidate => candidate.id === id)
    if (!item) return
    item.controller?.abort()
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    this.update(key, draft => ({ added: draft.added.filter(candidate => candidate !== item), notice: null }))
  }

  /**
   * Admit one batch of picked, pasted, or dropped files with the native
   * composer's checks, then start uploading them.
   * @returns a refusal as `[copyKey, values]`, or null when the batch was added.
   */
  addFiles(key, sessionId, files, { directories, limits, keptImageBytes }) {
    const draft = this.#drafts.get(key)
    if (!this.#editable(key) || files.length === 0) return null
    if (files.some(file => directories?.has(file))) return ['folder', {}]
    const mediaTypes = limits?.mediaTypes ?? IMAGE_TYPES
    const images = files.filter(file => mediaTypes.includes(file.type))
    if (limits) {
      const sizes = [...keptImageBytes, ...draft.added.filter(item => item.kind === 'image').map(item => item.file.size), ...images.map(file => file.size)]
      if (sizes.length > limits.maxImagesPerMessage) return ['tooMany', { count: limits.maxImagesPerMessage }]
      if (images.some(file => file.size > limits.maxImageBytes)) return ['imageTooLarge', { bytes: limits.maxImageBytes }]
      if (sizes.reduce((sum, size) => sum + size, 0) > limits.maxMessageImageBytes) return ['imagesTooLarge', { bytes: limits.maxMessageImageBytes }]
    }
    const added = files.map(file => {
      const image = images.includes(file)
      return { id: `added-${this.#nextId++}`, kind: image ? 'image' : 'file', file, previewUrl: image ? URL.createObjectURL(file) : undefined }
    })
    this.update(key, current => ({ added: [...current.added, ...added], notice: null }))
    for (const item of added) this.#upload(key, sessionId, item.id)
    return null
  }

  retry(key, sessionId, id) {
    if (!this.#editable(key)) return
    this.update(key, () => ({ notice: null }))
    this.#upload(key, sessionId, id)
  }

  #set(key, draft) {
    if (draft === undefined) this.#drafts.delete(key)
    else this.#drafts.set(key, draft)
    for (const listener of this.#listeners) listener()
  }

  #upload(key, sessionId, id) {
    const controller = new AbortController()
    // Every later write is dropped once this attempt is no longer the item's
    // current one: removed, retried, or its draft closed. The draft is found
    // by the attempt, as it may have moved to a replacing Session meanwhile.
    const patch = upload => {
      const current = item => item.id === id && item.controller === controller
      const [draftKey] = [...this.#drafts].find(([, draft]) => draft.added.some(current)) ?? []
      if (draftKey !== undefined) this.update(draftKey, draft => ({ added: draft.added.map(item => (current(item) ? { ...item, upload } : item)) }))
    }
    this.update(key, draft => ({
      added: draft.added.map(item => (item.id === id ? { ...item, controller, upload: { status: 'uploading', loaded: 0 } } : item)),
    }))
    const item = this.#drafts.get(key)?.added.find(candidate => candidate.id === id)
    if (!item) return
    const name = item.file.name || undefined
    const onProgress = ({ loaded, total }) => patch({ status: 'uploading', loaded, total })
    this.#queue.push(async () => {
      if (controller.signal.aborted) return
      try {
        const result = item.kind === 'image'
          ? await this.fileUpload.uploadImage(sessionId, item.file, item.file.type, name, controller.signal, onProgress)
          : await this.fileUpload.upload(sessionId, item.file, name, controller.signal, onProgress)
        if (controller.signal.aborted) return
        if (result.ok) patch({ status: 'ready', ref: result.value.image ?? result.value.file })
        else patch({ status: 'error', message: result.error.message, reason: result.error.code === 'session/attachment-invalid' ? result.error.details?.reason : undefined })
      } catch (cause) {
        if (!controller.signal.aborted) patch({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })
    this.#pump()
  }

  #pump() {
    while (this.#active < CONCURRENT_UPLOADS && this.#queue.length > 0) {
      this.#active++
      void this.#queue.shift()().finally(() => {
        this.#active--
        this.#pump()
      })
    }
  }
}

/** Subscribe a component to whether another edit of its Session is being sent. */
export function useSendingIn(drafts, sessionId) {
  return useSyncExternalStore(drafts.subscribe, () => drafts.sendingIn(sessionId))
}

/** Subscribe a component to one draft, or to its absence. */
export function useDraft(drafts, key) {
  return useSyncExternalStore(drafts.subscribe, () => (key === undefined ? undefined : drafts.get(key)))
}
