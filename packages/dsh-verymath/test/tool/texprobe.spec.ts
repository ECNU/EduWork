import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExecutable } from '../../src/tool/index.ts'

// Executable discovery for the beamer probe. The probe used to call
// `/usr/bin/which` and `/Library/TeX/texbin/kpsewhich` directly, which does not
// exist on Windows and points at a macOS-only directory, so a Linux or Windows
// host reported a missing TeX toolchain even with TeX installed. Resolution now
// happens in-process over a search path, which is what these tests pin down.

const created: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verymath-tex-'))
  created.push(dir)
  return dir
}

async function makeFile(dir: string, name: string, mode: number): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, '#!/bin/sh\nexit 0\n')
  if (process.platform !== 'win32') await chmod(file, mode)
  return file
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveExecutable', () => {
  it('finds an executable in the supplied search path', async () => {
    const dir = await makeDir()
    const file = await makeFile(dir, 'latexmk', 0o755)
    expect(resolveExecutable('latexmk', [dir])).toBe(file)
  })

  it('returns undefined when the name is in no search directory', async () => {
    const dir = await makeDir()
    expect(resolveExecutable('surely-not-installed-verymath', [dir])).toBeUndefined()
  })

  it('skips a file that exists but is not executable', async () => {
    // POSIX-only: on Windows the executable bit is not part of the access check.
    if (process.platform === 'win32') return
    const dir = await makeDir()
    await makeFile(dir, 'latexmk', 0o644)
    expect(resolveExecutable('latexmk', [dir])).toBeUndefined()
  })

  it('takes the first match so PATH order decides', async () => {
    const first = await makeDir()
    const second = await makeDir()
    const file = await makeFile(first, 'xelatex', 0o755)
    await makeFile(second, 'xelatex', 0o755)
    expect(resolveExecutable('xelatex', [first, second])).toBe(file)
  })

  it('accepts an absolute path without consulting the search path', async () => {
    const dir = await makeDir()
    const file = await makeFile(dir, 'kpsewhich', 0o755)
    expect(resolveExecutable(file, [])).toBe(file)
    expect(resolveExecutable(join(dir, 'absent'), [])).toBeUndefined()
  })
})
