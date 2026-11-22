/**
 * Executable discovery for the tools and the browser panel.
 *
 * Lives in `core` rather than `tool` because two surfaces need the same answer:
 * `verymath_sage_check` / `verymath_beamer_check` in the tool layer, and the
 * panel's environment route. When they disagreed, the panel reported SageMath
 * missing while the tool reported it available — the panel spawned a bare
 * `sage`, the tool resolved it through the conda environment directories.
 *
 * Resolution is in-process (no `which`/`where`): a desktop app launched from
 * Finder inherits no login-shell `PATH`, so distribution directories have to be
 * probed explicitly.
 *
 * @module @eduwork/dsh-verymath/core
 */
import { accessSync, constants, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Directories a TeX distribution installs into without adding them to the
 * inherited PATH. MacTeX's `/Library/TeX/texbin` is commonly invisible to a bare
 * spawn from a desktop app.
 */
function texBinFallbackDirs(): string[] {
  return process.platform === 'darwin' ? ['/Library/TeX/texbin'] : []
}

/**
 * Directories conda-style installs put `python3`/`sage` in but rarely add to the
 * PATH a desktop app inherits. Derived from the home directory, so nothing here
 * is machine-specific.
 */
function condaBinFallbackDirs(): string[] {
  const home = homedir()
  return ['miniforge3', 'mambaforge', 'miniconda3', 'anaconda3', 'micromamba']
    .map(name => join(home, name, 'bin'))
}

/** Conda distribution roots this package knows about, including its own documented layout. */
function condaRoots(): string[] {
  const home = homedir()
  return [
    join(home, '.verymath', 'miniforge'),
    join(home, 'miniforge3'),
    join(home, 'mambaforge'),
    join(home, 'miniconda3'),
    join(home, 'anaconda3'),
  ]
}

/** Executable search path: the inherited PATH first, then platform fallbacks. */
export function executableSearchDirs(): string[] {
  const fromEnv = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0)
  return [...new Set([...fromEnv, ...texBinFallbackDirs(), ...condaBinFallbackDirs()])]
}

/**
 * Search path for the SageMath probe only. `sage` is normally installed as a
 * *named* conda environment (`conda create -n sage sage=10.9`), so the base-env
 * directories are not where it lives; this adds `<root>/envs/<name>/bin` for each
 * known distribution root. Kept separate from the generic search path so TeX and
 * other lookups do not start probing unrelated environment trees.
 */
export function sageSearchDirs(): string[] {
  const dirs = [...executableSearchDirs()]
  for (const root of condaRoots()) {
    const envsDir = join(root, 'envs')
    let names: string[]
    try {
      names = readdirSync(envsDir).sort((left, right) => left.localeCompare(right))
    } catch {
      continue
    }
    for (const name of names) dirs.push(join(envsDir, name, 'bin'))
  }
  return [...new Set(dirs)]
}

/** Whether `candidate` exists and the current user may execute it. */
function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve an executable name to an absolute path. Resolving in-process avoids
 * `which`/`where`, which are not both available and which cannot see the fallback
 * directories above. On Windows the `PATHEXT` suffixes are tried.
 * @param name - bare executable name, or a path containing a separator.
 * @param searchDirs - directories probed for a bare name (defaults to PATH plus fallbacks).
 * @returns the resolved absolute path, or undefined when nothing is executable.
 */
export function resolveExecutable(name: string, searchDirs: readonly string[] = executableSearchDirs()): string | undefined {
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    return isExecutableFile(name) ? name : undefined
  }
  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext.length > 0)]
    : ['']
  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Resolve the `sage` executable: an explicit `VERYMATH_SAGE` path wins, then the
 * SageMath search path (PATH, TeX/conda base dirs, named conda environments).
 * An override that is not executable is ignored rather than reported as found.
 */
export function resolveSageExecutable(): string | undefined {
  const override = process.env.VERYMATH_SAGE
  if (override !== undefined && override.trim().length > 0) {
    const resolved = resolveExecutable(override.trim(), [])
    if (resolved !== undefined) return resolved
  }
  return resolveExecutable('sage', sageSearchDirs())
}

/**
 * Resolve a Python interpreter: the configured executable, then `python3`, then
 * `python`, each through the shared search path so a conda install is found too.
 * @param configured - explicit path or name from plugin config / `DSH_OFFICE_PYTHON`.
 */
export function resolvePythonExecutable(configured?: string): string | undefined {
  const candidates = [...new Set([configured, 'python3', 'python'].filter((name): name is string => name !== undefined && name.length > 0))]
  for (const candidate of candidates) {
    const resolved = resolveExecutable(candidate)
    if (resolved !== undefined) return resolved
  }
  return undefined
}
