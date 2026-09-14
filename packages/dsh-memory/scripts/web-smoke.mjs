import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { start, command } from './harness.mjs'
const host = await start()
try {
  await command(process.execPath, ['scripts/browser-check.mjs', host.url, path.join(host.directory, 'memory.png')], { env: host.env })
  await writeFile(path.join(host.directory, 'web-result.json'), JSON.stringify({ passed: true, dsh: host.dsh, package: host.package, records: 31, pageSize: 10 }))
  console.log('Independent packed Web passed:', host.directory)
} finally { await host.stop() }
