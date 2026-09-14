import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { packages, groups, selectPackage, changedGroups, needsProductBuild } from './catalog.mjs'
import { npm } from './npm.mjs'
import { inspectArchive } from './archive.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [action, id, argument] = process.argv.slice(2)
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (action === 'list') {
  console.log(JSON.stringify(packages, null, 2))
} else if (action === 'changed' || action === 'product-changed') {
  const files = id && !/^0+$/.test(id) ? git(['diff', '--name-only', `${id}...HEAD`]).split('\n') : git(['ls-files']).split('\n')
  const selected = action === 'product-changed' ? needsProductBuild(files) : changedGroups(files)
  const output = action === 'product-changed' ? 'build' : 'groups'
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${output}=${JSON.stringify(selected)}\n`)
  console.log(JSON.stringify(selected))
} else if (['install', 'check', 'pack'].includes(action)) {
  const selected = selectPackage(id)
  const cwd = join(root, 'packages', selected.group)
  if (action === 'install') npm(['ci'], { cwd, stdio: 'inherit' })
  if (action === 'check') {
    const scripts = {
      'dsh-oidc': ['check'],
      'dsh-mail': ['check'],
      'dsh-memory': ['build', 'test'],
      'dsh-knowledge-studio': ['typecheck', 'build', 'test', 'audit'],
    }
    for (const script of scripts[selected.group]) npm(['run', script], { cwd, stdio: 'inherit' })
  }
  if (action === 'pack') {
    const output = resolve(root, argument || `dist/npm-packages/${id}`)
    await mkdir(output, { recursive: true })
    const manifest = JSON.parse(await readFile(join(root, selected.directory, 'package.json'), 'utf8'))
    // Build/check is a separate explicit step. Publication uses these exact, inspected bytes.
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: join(root, selected.directory) }))
    const bytes = await readFile(join(output, packed.filename))
    const inspected = inspectArchive(bytes, selected, manifest.version)
    const receipt = { schemaVersion: 1, id, name: manifest.name, version: manifest.version, directory: selected.directory, sourceCommit: git(['rev-parse', 'HEAD']), sourceDirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal'])), filename: packed.filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), files: inspected.files }
    await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify({ ...receipt, files: receipt.files.length }, null, 2))
  }
} else {
  throw new Error(`Usage: node scripts/packages/manage.mjs list | changed [base] | install|check|pack <${groups.join('|')}|dsh-artifact-services> [output]`)
}
