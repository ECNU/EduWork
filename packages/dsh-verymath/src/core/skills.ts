/**
 * Bundled-skill provider for the VeryMath capability seam: exposes the
 * skills shipped inside the plugin package through the DSH skill registry,
 * mirroring the filesystem provider's bundled-root behavior (rank 600,
 * `source: 'bundled'`, directory resource bases).
 * @module @eduwork/dsh-verymath/core
 */
import { readFile, realpath, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { BUNDLED_SKILL_RANK, isSkillName, type SkillProvider, type SkillCandidate, type SkillDefinition, type SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { bundledSkillsDir } from './paths.ts'

/** Minimal YAML frontmatter parse for SKILL.md (name/description/whenToUse). */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (entry === null || entry[1] === undefined || entry[2] === undefined) continue
    data[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, '')
  }
  return { data, body: match[2] }
}

/** One discovered bundled skill's file locator. */
interface BundledLocator {
  readonly path: string
  readonly directory: string
}

/** Real discovery: read `<skills>/<name>/SKILL.md` frontmatter for each entry. */
async function listBundledSkills(signal?: AbortSignal): Promise<readonly SkillCandidate[]> {
  const root = bundledSkillsDir()
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  if (signal?.aborted === true) return []
  const candidates: SkillCandidate[] = []
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    const skillPath = join(directory, 'SKILL.md')
    let raw: string
    try {
      raw = await readFile(skillPath, { encoding: 'utf8', signal })
    } catch {
      continue
    }
    const parsed = parseFrontmatter(raw)
    const name = parsed?.data.name
    const description = parsed?.data.description
    if (parsed === undefined || name === undefined || description === undefined || !isSkillName(name)) continue
    candidates.push({
      name,
      description,
      ...(parsed.data.whenToUse !== undefined ? { whenToUse: parsed.data.whenToUse } : {}),
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'verymath-bundled',
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      locator: { path: skillPath, directory },
      resourceBase: { kind: 'directory', path: directory },
      path: skillPath,
    })
  }
  return candidates
}

/** Load one bundled skill body from its locator. */
async function loadBundledSkill(candidate: SkillCandidate, signal?: AbortSignal): Promise<SkillDefinition | undefined> {
  const locator = candidate.locator as BundledLocator
  let raw: string
  try {
    const resolved = await realpath(locator.path)
    raw = await readFile(resolved, { encoding: 'utf8', signal })
  } catch {
    return undefined
  }
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) return undefined
  return {
    name: parsed.data.name ?? candidate.name,
    description: parsed.data.description ?? candidate.description,
    ...(parsed.data.whenToUse !== undefined ? { whenToUse: parsed.data.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'verymath-bundled',
    source: 'bundled',
    resourceBase: { kind: 'directory', path: locator.directory },
    path: locator.path,
    content: parsed.body.trim(),
  }
}

/**
 * Provider over the plugin package's `skills/` directory.
 * Registered on `ctx.skills` during `apply()`; bodies are loaded from disk
 * on demand so registry startup stays cheap.
 */
export class VeryMathSkillProvider implements SkillProvider {
  readonly name = 'verymath-bundled'

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    return listBundledSkills(options.signal)
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    return loadBundledSkill(candidate, options.signal)
  }
}
