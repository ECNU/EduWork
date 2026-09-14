import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { callNativeBridge } from './client.js'
import { nativeRecordRef, normalizeCredentialRecord } from './records.js'

export { nativeRecordRef, normalizeCredentialRecord } from './records.js'

export const name = 'credentials-native'

const RECORD_INDEX_REF = 'DSH_CREDENTIAL_RECORD_INDEX_V1'

export class NativeCredentialProvider extends CredentialProvider {
  static inject = ['desktopBoundary']

  constructor(ctx) {
    super(ctx)
    this.boundary = ctx.desktopBoundary.ready
    // DSH alpha.1 makes record writes an atomic read-decide-replace operation.
    // One desktop process owns the native bridge, so a provider-wide queue is
    // the matching exclusion boundary while values remain in Credential Manager.
    this.recordOperations = Promise.resolve()
  }

  async resolve(ref) {
    const { nativeBridge } = await this.boundary
    const result = await callNativeBridge(nativeBridge, 'resolve', { ref })
    if (!result.configured) return undefined
    return { value: result.value, source: result.source }
  }

  async describe(ref) {
    const { nativeBridge } = await this.boundary
    const result = await callNativeBridge(nativeBridge, 'describe', { ref })
    return { configured: result.configured, source: result.source, writable: result.writable }
  }

  async set(ref, value) {
    if (value.length === 0) throw new Error(`credentials-native: an empty value cannot be stored for "${ref}"; use unset`)
    const { nativeBridge } = await this.boundary
    await callNativeBridge(nativeBridge, 'set', { ref, value })
    this.notifyUpdated(ref)
  }

  async unset(ref) {
    const { nativeBridge } = await this.boundary
    await callNativeBridge(nativeBridge, 'unset', { ref })
    this.notifyUpdated(ref)
  }

  async readRecord(key) {
    const { nativeBridge } = await this.boundary
    const result = await callNativeBridge(nativeBridge, 'resolve', { ref: nativeRecordRef(key) })
    if (!result.configured) return undefined
    let parsed
    try {
      parsed = JSON.parse(result.value)
    } catch {
      throw new Error(`credentials-native: stored record "${key}" is not valid JSON`)
    }
    return normalizeCredentialRecord(key, parsed)
  }

  async describeRecord(key) {
    const record = await this.readRecord(key)
    return record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true }
  }

  async listRecords() {
    const entries = await this.readRecordIndex()
    return entries.map(({ key, kind }) => ({ key, kind }))
  }

  async modifyRecord(key, mutate) {
    if (typeof mutate !== 'function') throw new TypeError('credentials-native: record mutator must be a function')
    return this.enqueueRecord(async () => {
      const current = await this.readRecord(key)
      const candidate = await mutate(current)
      if (candidate === undefined) return current
      const next = normalizeCredentialRecord(key, candidate)
      const { nativeBridge } = await this.boundary
      await callNativeBridge(nativeBridge, 'set', {
        ref: nativeRecordRef(key),
        value: JSON.stringify(next),
      })
      await this.updateRecordIndex(key, next.kind)
      this.notifyRecordUpdated(key)
      return next
    })
  }

  async deleteRecord(key) {
    return this.enqueueRecord(async () => {
      const current = await this.readRecord(key)
      const { nativeBridge } = await this.boundary
      await callNativeBridge(nativeBridge, 'unset', { ref: nativeRecordRef(key) })
      await this.updateRecordIndex(key, undefined)
      if (current !== undefined) this.notifyRecordUpdated(key)
    })
  }

  enqueueRecord(operation) {
    const task = this.recordOperations.then(operation)
    this.recordOperations = task.then(() => undefined, () => undefined)
    return task
  }

  async readRecordIndex() {
    const { nativeBridge } = await this.boundary
    const result = await callNativeBridge(nativeBridge, 'resolve', { ref: RECORD_INDEX_REF })
    if (!result.configured) return []
    let index
    try {
      index = JSON.parse(result.value)
    } catch {
      throw new Error('credentials-native: stored record index is not valid JSON')
    }
    if (index?.version !== 1 || !Array.isArray(index.records)) {
      throw new Error('credentials-native: stored record index has an unsupported shape')
    }
    return index.records.map((entry) => {
      if (typeof entry?.key !== 'string' || (entry.kind !== 'grant' && entry.kind !== 'api-key')) {
        throw new Error('credentials-native: stored record index contains an invalid entry')
      }
      nativeRecordRef(entry.key)
      return { key: entry.key, kind: entry.kind }
    })
  }

  async updateRecordIndex(key, kind) {
    const entries = (await this.readRecordIndex()).filter(entry => entry.key !== key)
    if (kind !== undefined) entries.push({ key, kind })
    entries.sort((left, right) => left.key.localeCompare(right.key))
    const { nativeBridge } = await this.boundary
    if (entries.length === 0) {
      await callNativeBridge(nativeBridge, 'unset', { ref: RECORD_INDEX_REF })
      return
    }
    await callNativeBridge(nativeBridge, 'set', {
      ref: RECORD_INDEX_REF,
      value: JSON.stringify({ version: 1, records: entries }),
    })
  }
}

export default NativeCredentialProvider
