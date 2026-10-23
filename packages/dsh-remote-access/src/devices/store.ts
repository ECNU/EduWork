/**
 * The Host's persistent remote-access state: its two long-term keys and the
 * devices its owner approved. Devices are known by public key only; nothing a
 * device could reuse elsewhere is stored. One file, written atomically and
 * readable by the owner alone.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { base64url, fromBase64url } from '../protocol/bytes.ts'
import { generateKeyPair, type KeyPair } from '../protocol/noise.ts'
import { hostIdOf } from '../protocol/relay.ts'

export interface Device {
  /** The device's P-256 public key from `auth`. */
  readonly key: string
  readonly name: string
  readonly pairedAt: string
  readonly lastSeen?: string
}

export interface HostIdentity {
  /** Base64url Ed25519 public key; the relay routes devices by it. */
  readonly hostId: string
  /** Signs relay registrations. */
  readonly signingKey: CryptoKey
  /** Noise static key pinned by pairing links. */
  readonly noise: KeyPair
}

interface Stored {
  readonly version: 1
  /** PKCS#8 Ed25519 private key and the raw public key, base64url. */
  readonly signing: { readonly privateKey: string; readonly publicKey: string }
  readonly noise: string
  readonly devices: readonly Device[]
}

export class HostStore {
  readonly identity: HostIdentity
  readonly #path: string
  #state: Stored
  #writing = Promise.resolve()

  /** Load the state at `path`, creating a new identity on first use. */
  static async open(path: string): Promise<HostStore> {
    let state: Stored
    try {
      state = JSON.parse(await readFile(path, 'utf8')) as Stored
      if (state.version !== 1) throw new Error(`unsupported state version ${String(state.version)} in ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
      state = {
        version: 1,
        signing: {
          privateKey: base64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))),
          publicKey: await hostIdOf(signing.publicKey),
        },
        noise: base64url(generateKeyPair().secretKey),
        devices: [],
      }
      await persist(path, state)
    }
    const signingKey = await crypto.subtle.importKey('pkcs8', fromBase64url(state.signing.privateKey), 'Ed25519', false, ['sign'])
    return new HostStore(path, state, { hostId: state.signing.publicKey, signingKey, noise: generateKeyPair(fromBase64url(state.noise)) })
  }

  private constructor(path: string, state: Stored, identity: HostIdentity) {
    this.#path = path
    this.#state = state
    this.identity = identity
  }

  get devices(): readonly Device[] { return this.#state.devices }

  device(key: string): Device | undefined {
    return this.#state.devices.find(device => device.key === key)
  }

  add(device: Device): Promise<void> {
    return this.#update(devices => [...devices.filter(d => d.key !== device.key), device])
  }

  remove(key: string): Promise<void> {
    return this.#update(devices => devices.filter(d => d.key !== key))
  }

  seen(key: string, at: string): Promise<void> {
    return this.#update(devices => devices.map(d => d.key === key ? { ...d, lastSeen: at } : d))
  }

  /** Apply changes in order; each write replaces the whole file. */
  #update(change: (devices: readonly Device[]) => readonly Device[]): Promise<void> {
    this.#state = { ...this.#state, devices: change(this.#state.devices) }
    const state = this.#state
    const write = this.#writing.then(() => persist(this.#path, state))
    this.#writing = write.catch(() => {})
    return write
  }
}

async function persist(path: string, state: Stored): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}
