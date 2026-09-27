// Source-candidate adapter: keep the pinned DSH resource contract for prose
// file links, including delivered files. Explicit native-open menus are unchanged.
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, readdir } from 'node:fs/promises'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { upstream: { type: 'string' }, output: { type: 'string' } } })
if (!values.upstream || !values.output) throw Error('Use --upstream <pinned compiler> --output <new directory>')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = resolve(values.upstream), output = resolve(values.output)
const lock = JSON.parse(await readFile(join(root, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json'), 'utf8'))
execFileSync('pwsh', ['-NoProfile', '-File', join(root, 'dsh-desktop/scripts/test-dsh-compatibility.ps1'), '-Upstream', upstream, '-LockPath', join(root, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json')], { stdio: 'inherit' })
const base = 'packages/client/ui-deliverables/'
const stage = await mkdtemp(join(upstream, 'packages/extensions/eduwork-deliverables-'))
const hash = data => createHash('sha256').update(data).digest('hex')
try {
  const sourceHashes = {}
  const files = ['package.json', ...(await readdir(join(upstream, base, 'src'), { recursive: true, withFileTypes: true })).filter(item => item.isFile()).map(item => relative(join(upstream, base), join(item.parentPath, item.name)))]
  for (const name of files) {
    const file = base + name
    const content = await readFile(join(upstream, file), 'utf8')
    sourceHashes[file] = hash(content)
    await mkdir(dirname(join(stage, name)), { recursive: true })
    await writeFile(join(stage, name), content)
  }
  const entry = join(stage, 'src/client/index.ts')
  const before = await readFile(entry, 'utf8')
  const from = `        const file = deliveries.get(path)
        if (file === undefined) owner.openFile(path)
        else void opener.open(sessionId, file.seq, file.index)
      }, path => t(deliveries.has(path) ? 'presented.open' : 'produced.open', { name: path }))`
  if (before.split(from).length !== 2) throw Error('Pinned file-link adapter anchor changed')
  await writeFile(entry, before.replace(from, `        owner.openFile(path)
      }, path => t('produced.open', { name: path }))`))
  await writeFile(join(stage, 'tsdown.config.ts'), `import { clientBundle } from '../../client/tsdown.client.ts'\nexport default clientBundle('@deepseek-ai/dsh-client-ui-deliverables', ['src/index.ts'])\n`)
  execFileSync(join(upstream, 'node_modules/.bin/tsdown'), ['--config', 'tsdown.config.ts'], { cwd: stage, stdio: 'inherit' })
  await mkdir(output, { recursive: false })
  await copyFile(join(stage, 'lib/client.js'), join(output, 'client.js'))
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ upstreamCommit: lock.commit, sourceHashes,
    adapter: hash(await readFile(fileURLToPath(import.meta.url))), client: hash(await readFile(join(output, 'client.js'))) }, null, 2))
} finally { await rm(stage, { recursive: true, force: true }) }
