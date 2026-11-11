// EduWork host adapter: Orca's vault format and store are unchanged. The host
// uses npm's write-file-atomic for staged, fsynced writes under its userData.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
export function writeSecureFile(path: string, contents: string): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileAtomic.sync(path, contents, { mode: 0o600, fsync: true })
  return process.platform !== 'win32' // Windows uses inherited userData ACLs.
}
