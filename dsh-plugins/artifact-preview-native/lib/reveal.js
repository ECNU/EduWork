import { execFile, spawn } from 'node:child_process'
import path from 'node:path'

export function revealInFileManager(target, signal, runtime = { platform: process.platform, execFile, spawn }) {
  signal?.throwIfAborted()
  const command = runtime.platform === 'win32' ? 'explorer.exe' : runtime.platform === 'darwin' ? 'open' : 'xdg-open'
  // Explorer parses /select itself: use a native absolute path and quote only
  // that path. A file: URL may open Desktop instead, while an unquoted comma
  // or space can change the selected target. Quotes/NUL are not file names.
  if (runtime.platform === 'win32' && (!path.win32.isAbsolute(target) || /["\0\r\n]/u.test(target))) {
    throw new Error('file manager requires an absolute Windows file path')
  }
  const args = runtime.platform === 'win32' ? [`/select,"${path.win32.normalize(target)}"`] : runtime.platform === 'darwin' ? ['-R', target] : [path.dirname(target)]
  // Explorer commonly exits with code 1 after handing the selection to its
  // existing process. Wait for that handoff: resolving on 'spawn' lets the
  // completed RPC abort its signal and kill Explorer before it opens the file.
  if (runtime.platform === 'win32') {
    return new Promise((resolve, reject) => {
      // Explorer is the UI requested by the user, so do not hide its window.
      const child = runtime.spawn(command, args, {
        windowsHide: false,
        windowsVerbatimArguments: true,
        stdio: 'ignore',
        signal,
      })
      child.once('exit', (code) => {
        if (code === 0 || code === 1) resolve()
        else reject(new Error(`file manager could not reveal the artifact (exit ${code})`))
      })
      child.once('error', error => reject(new Error(`file manager could not reveal the artifact: ${error.message}`)))
    })
  }
  return new Promise((resolve, reject) => {
    runtime.execFile(command, args, { windowsHide: true, timeout: 10_000, signal }, error => {
      if (error !== null) {
        reject(new Error(`file manager could not reveal the artifact: ${error.message}`))
        return
      }
      resolve()
    })
  })
}
