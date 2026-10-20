/**
 * The computers this browser is paired with, in IndexedDB. Each has its own
 * device key, generated non-extractable: page scripts can sign with it but
 * cannot read it out.
 */
export interface PairedHost {
  readonly hostId: string
  /** The Host's Noise static key from the pairing link. */
  readonly hostKey: Uint8Array
  /** As the Host named itself. */
  readonly name: string
  readonly device: CryptoKeyPair
  readonly pairedAt: string
}

const STORE = 'hosts'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('eduwork-remote', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'hostId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = operation(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export const pairedHosts = (): Promise<PairedHost[]> => run('readonly', store => store.getAll() as IDBRequest<PairedHost[]>)
export const pairedHost = (hostId: string): Promise<PairedHost | undefined> => run('readonly', store => store.get(hostId) as IDBRequest<PairedHost | undefined>)
export const rememberHost = async (host: PairedHost): Promise<void> => { await run('readwrite', store => store.put(host)) }
export const forgetHost = async (hostId: string): Promise<void> => { await run('readwrite', store => store.delete(hostId)) }
