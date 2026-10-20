// The subset of noise-handshake@4 used by noise.ts.
declare module 'noise-handshake' {
  interface KeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
  export default class NoiseState {
    constructor(pattern: 'IK', initiator: boolean, staticKeyPair?: KeyPair | null)
    readonly s: KeyPair
    readonly complete: boolean
    readonly rx: Uint8Array
    readonly tx: Uint8Array
    readonly hash: Uint8Array
    readonly curve: { generateKeyPair(): KeyPair }
    initialise(prologue: Uint8Array, remoteStatic?: Uint8Array): void
    send(payload?: Uint8Array): Uint8Array
    recv(message: Uint8Array): Uint8Array
  }
}

declare module 'noise-handshake/cipher.js' {
  export default class CipherState {
    constructor(key: Uint8Array)
    encrypt(plaintext: Uint8Array): Uint8Array
    decrypt(ciphertext: Uint8Array): Uint8Array
  }
}

declare module 'noise-handshake/dh.js' {
  export function generateKeyPair(secretKey?: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array }
}
