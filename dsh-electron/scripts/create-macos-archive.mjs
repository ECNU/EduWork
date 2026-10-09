import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function createMacOSAppArchive(appPath, archivePath) {
  if (process.platform !== 'darwin') throw new Error('macOS app archives must be created on macOS')
  const app = resolve(appPath), archive = resolve(archivePath)
  if (extname(app) !== '.app' || !(await stat(app)).isDirectory()) throw new Error('A macOS app bundle is required')
  if (extname(archive) !== '.zip') throw new Error('A ZIP output path is required')
  // AppleDouble directories can look like a second .app to Sparkle. Exclude
  // resource forks and filesystem metadata while retaining symlinks and modes.
  await run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noacl', '--keepParent', app, archive])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Use create-macos-archive.mjs <signed.app> <output.zip>')
  await createMacOSAppArchive(process.argv[2], process.argv[3])
}
