// Runs the source audit under a deliberately small V8 stack so the aggregate
// that used to be spread into a call can be reproduced with a small tree. The
// probe also verifies its own premise: if spreading the same number of entries
// stops failing under this stack, the scenario no longer represents the bug and
// the test must be revisited rather than passing quietly.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditDistribution } from '../../scripts/audit-eduwork-distribution.mjs'

const files = Number(process.argv[2] ?? 7000)
const root = await mkdtemp(join(tmpdir(), 'eduwork-audit-stack-'))
try {
  const directory = join(root, 'vendor-big')
  await mkdir(directory, { recursive: true })
  const names = Array.from({ length: files }, (unused, index) => `entry-${index}.txt`)
  await Promise.all(names.map(name => writeFile(join(directory, name), 'synthetic\n')))

  const aggregate = names.slice()
  let spreadFails = false
  try { Reflect.apply(() => {}, undefined, aggregate) } catch { spreadFails = true }

  const report = auditDistribution({ root })
  console.log(JSON.stringify({
    files,
    spreadFails,
    reported: report.files,
    errors: report.errors,
    entry: fileURLToPath(import.meta.url),
  }))
} finally { await rm(root, { recursive: true, force: true }) }
