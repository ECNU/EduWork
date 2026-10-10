// Build and inspect the installation image from the exact app accepted from ZIP.
import { lstat, readlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { capture, ensureDir, isFile, pathExists, run, sha256File } from './lib/build-util.mjs'

export async function prepareMacosDmg({ app, output, workDirectory, coreRoot }) {
  if (process.platform !== 'darwin') throw new Error('DMG packaging requires macOS')
  if (!await isFile(join(app, 'Contents/Info.plist'))) throw new Error('A complete signed application is required')
  if (!output.endsWith('.dmg') || await pathExists(output) || await pathExists(workDirectory)) {
    throw new Error('Choose a new DMG and packaging workspace')
  }
  await ensureDir(workDirectory)
  const builder = join(coreRoot, 'scripts/macos-dmg')
  const venv = join(workDirectory, 'venv')
  await run('python3', ['-m', 'venv', venv])
  const python = join(venv, 'bin/python3')
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--only-binary=:all:', '--require-hashes', '-r', join(builder, 'requirements.txt')])
  await run(python, ['-B', '-m', 'unittest', 'discover', '-s', builder, '-p', 'test_*.py'])
  await run(python, ['-B', join(builder, 'package.py'), '--app', app, '--output', output])

  const mount = join(workDirectory, 'mounted')
  await ensureDir(mount)
  let device = ''
  try {
    device = await capture(python, ['-B', join(builder, 'volume.py'), 'attach', output, mount, '--readonly'])
    const installed = join(mount, basename(app))
    await run('codesign', ['--verify', '--deep', '--strict', installed])
    const differences = await capture('rsync', ['--recursive', '--links', '--checksum', '--dry-run', '--delete', '--itemize-changes', `${app}/`, `${installed}/`])
    if (differences) throw new Error(`DMG application differs from the verified ZIP: ${differences}`)
    if ((await readlink(join(mount, 'Applications'))) !== '/Applications') throw new Error('DMG Applications shortcut is invalid')
    for (const file of ['.DS_Store', '.background/background.png']) {
      if (!await isFile(join(mount, file))) throw new Error(`DMG window resource missing: ${file}`)
    }
  } finally {
    if (device) await run(python, ['-B', join(builder, 'volume.py'), 'detach', device])
  }
  const sha256 = await sha256File(output)
  const name = basename(output)
  await writeFile(`${output}.sha256`, `${sha256}  ${name}\n`)
  return {
    asset: { name, bytes: (await lstat(output)).size, sha256 },
    checks: {
      imageIntegrity: 'passed', applicationSignature: 'passed',
      matchesZipApplication: 'passed', installationWindow: 'passed',
    },
  }
}
