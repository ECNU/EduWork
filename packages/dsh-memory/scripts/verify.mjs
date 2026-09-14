import { command, root, runtimeVersion } from './harness.mjs'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
await mkdir('artifacts', { recursive: true })
const startedAt = new Date().toISOString()
await writeFile('artifacts/verification-start.json', JSON.stringify({ pid: process.pid, startedAt }))
const npm = async args => {
  const result = await command(process.execPath, [process.env.npm_execpath, ...args])
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  return result
}
try {
  await npm(['run', 'build'])
  await npm(['test'])
  const packed = await npm(['pack', '--json', '--pack-destination', 'artifacts'])
  const [metadata] = JSON.parse(packed.stdout)
  const pkg = JSON.parse(await readFile('package.json'))
  const tarball = path.join(root, 'artifacts', metadata.filename)
  process.env.MEMORY_TARBALL = tarball
  await npm(['run', 'test:host'])
  await npm(['run', 'test:web'])
  const audit = await npm(['audit', '--json'])
  await writeFile('artifacts/audit.json', audit.stdout)
  const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
  await writeFile('artifacts/verification.json', JSON.stringify({ passed: true, startedAt, finishedAt: new Date().toISOString(), node: process.version, package: `${pkg.name}@${pkg.version}`, tarball: metadata.filename, dsh: runtimeVersion, auditScope: 'local development dependency lock', bytes: (await stat(tarball)).size, sha256 }, null, 2))
} catch (error) {
  await writeFile('artifacts/verification.json', JSON.stringify({ passed: false, startedAt, error: String(error) }, null, 2))
  throw error
}
