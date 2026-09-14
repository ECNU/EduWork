import { createHash } from 'node:crypto'

const RECORD_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function nativeRecordRef(key) {
  if (!RECORD_KEY_PATTERN.test(key)) throw new TypeError('credentials-native: invalid credential record key')
  return `DSH_CREDENTIAL_RECORD_${createHash('sha256').update(key, 'utf8').digest('hex').toUpperCase()}`
}

function assertOnlyFields(record, allowed, key) {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) throw new TypeError(`credentials-native: record "${key}" has unknown field "${field}"`)
  }
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError('credentials-native: grant payload holds a non-finite number')
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('credentials-native: grant payload is cyclic')
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value)
      for (const nested of Object.values(value)) assertJsonValue(nested, seen)
      seen.delete(value)
      return
    }
  }
  throw new TypeError('credentials-native: grant payload holds a value JSON cannot represent')
}

export function normalizeCredentialRecord(key, record) {
  nativeRecordRef(key)
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new TypeError(`credentials-native: record "${key}" must be an object`)
  }
  if (record.kind === 'grant') {
    assertOnlyFields(record, ['kind', 'payload'], key)
    if (!Object.hasOwn(record, 'payload')) throw new TypeError(`credentials-native: record "${key}" has no payload`)
    assertJsonValue(record.payload)
    return { kind: 'grant', payload: record.payload }
  }
  if (record.kind === 'api-key') {
    assertOnlyFields(record, ['kind', 'key', 'env'], key)
    if (record.key !== undefined && (typeof record.key !== 'string' || record.key.length === 0)) {
      throw new TypeError(`credentials-native: record "${key}" has an invalid key`)
    }
    let env
    if (record.env !== undefined) {
      if (typeof record.env !== 'object' || record.env === null || Array.isArray(record.env)) {
        throw new TypeError(`credentials-native: record "${key}" has an invalid env mapping`)
      }
      env = {}
      for (const [envName, value] of Object.entries(record.env)) {
        if (!ENV_NAME_PATTERN.test(envName) || typeof value !== 'string' || value.length === 0) {
          throw new TypeError(`credentials-native: record "${key}" has an invalid environment entry`)
        }
        env[envName] = value
      }
    }
    return {
      kind: 'api-key',
      ...(record.key === undefined ? {} : { key: record.key }),
      ...(env === undefined ? {} : { env }),
    }
  }
  throw new TypeError(`credentials-native: record "${key}" has an unknown kind`)
}
