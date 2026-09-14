import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function npm(args, options = {}) {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  const cli = candidates.find(path => path && existsSync(path))
  if (!cli) throw new Error('Use a Node distribution containing npm, or set npm_execpath to npm-cli.js.')
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options })
}
