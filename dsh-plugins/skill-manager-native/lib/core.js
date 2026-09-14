import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

// The assembled DSH runtime pins yaml@2.9.0. The narrow fallback keeps the
// package's dependency-free core tests runnable before assembly; release
// smoke separately asserts that production resolves the full YAML parser.
const parseYaml = await import('yaml').then(module => module.parse).catch(() => parseSimpleYaml)

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_INSTRUCTIONS_BYTES = 256 * 1024
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024
const MAX_BUNDLE_FILES = 256
const MAX_BUNDLE_DEPTH = 12

export class SkillStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SkillStoreError'
    this.code = code
  }
}

export class PersonalSkillStore {
  constructor(dshHome = process.env.DSH_HOME) {
    if (typeof dshHome !== 'string' || dshHome.trim().length === 0) {
      throw new SkillStoreError('skill_home_unavailable', '个人技能目录不可用。')
    }
    this.home = resolve(dshHome)
    this.root = join(this.home, 'skills')
    this.stagingRoot = join(this.home, '.skill-staging')
    this.trashRoot = join(this.home, '.skill-trash')
  }

  async list() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.root, { withFileTypes: true })
    const skills = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.system') continue
      const path = entry.isDirectory()
        ? join(this.root, entry.name, 'SKILL.md')
        : entry.isFile() && entry.name.endsWith('.md') ? join(this.root, entry.name) : undefined
      if (path === undefined) continue
      try {
        const parsed = parseSkillMarkdown(await readFile(path, 'utf8'))
        skills.push(summary(parsed))
      } catch {
        // DSH itself ignores malformed skill files. Keep the management list
        // aligned with the effective catalog instead of presenting a false
        // "available" row for content the Runtime will reject.
      }
    }
    return { skills }
  }

  async create(input) {
    const name = validateName(input?.name)
    const description = validateDescription(input?.description)
    const instructions = validateInstructions(input?.instructions)
    const markdown = buildSkillMarkdown({ name, description, instructions })
    return await this.install(name, async (stage) => {
      await writeFile(join(stage, 'SKILL.md'), markdown, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    })
  }

  async importDirectory(sourcePath) {
    if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0 || !isAbsolute(sourcePath)) {
      throw new SkillStoreError('skill_import_invalid', '请选择一个有效的技能文件夹。')
    }
    const source = resolve(sourcePath)
    const sourceInfo = await safeLstat(source, 'skill_import_unreadable', '无法读取所选技能文件夹。')
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new SkillStoreError('skill_import_invalid', '所选位置必须是普通文件夹，不能是符号链接。')
    }
    const definition = join(source, 'SKILL.md')
    const parsed = parseSkillMarkdown(await safeRead(definition))
    return await this.install(parsed.name, async (stage) => {
      const budget = { files: 0, bytes: 0 }
      await copyDirectory(source, stage, budget, 0)
    }, parsed)
  }

  async remove(nameValue) {
    const name = validateName(nameValue)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const matches = await this.findByName(name)
    if (matches.length === 0) {
      throw new SkillStoreError('skill_not_found', `个人技能“${name}”不存在或已被移除。`)
    }
    if (matches.length > 1) {
      throw new SkillStoreError('skill_ambiguous', `个人技能“${name}”存在多个定义，请先打开个人技能目录整理。`)
    }
    const match = matches[0]
    await mkdir(this.trashRoot, { recursive: true, mode: 0o700 })
    const destination = containedPath(this.trashRoot, `${name}-${Date.now()}-${randomUUID()}`)
    try {
      await rename(match.path, destination)
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        throw new SkillStoreError('skill_not_found', `个人技能“${name}”不存在或已被移除。`)
      }
      throw cause
    }
    return summary(match.parsed)
  }

  async findByName(name) {
    const entries = await readdir(this.root, { withFileTypes: true })
    const matches = []
    for (const entry of entries) {
      if (entry.name === '.system') continue
      const entryPath = containedPath(this.root, entry.name)
      const info = await safeLstat(entryPath, 'skill_remove_unreadable', '无法读取个人技能目录。')
      if (info.isSymbolicLink()) continue
      const definition = info.isDirectory()
        ? join(entryPath, 'SKILL.md')
        : info.isFile() && entry.name.endsWith('.md') ? entryPath : undefined
      if (definition === undefined) continue
      try {
        const parsed = parseSkillMarkdown(await readFile(definition, 'utf8'))
        if (parsed.name === name) matches.push({ path: entryPath, parsed })
      } catch {
        // Match the list contract: malformed definitions are not managed as
        // available Skills and therefore cannot be removed by display name.
      }
    }
    return matches
  }

  async install(name, populate, parsed) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    const destination = containedPath(this.root, name)
    if (await exists(destination)) {
      throw new SkillStoreError('skill_exists', `技能“${name}”已经存在，请先更换名称。`)
    }
    const stage = containedPath(this.stagingRoot, `${name}-${randomUUID()}`)
    await mkdir(stage, { mode: 0o700 })
    try {
      await populate(stage)
      const verified = parseSkillMarkdown(await safeRead(join(stage, 'SKILL.md')))
      if (verified.name !== name) {
        throw new SkillStoreError('skill_name_mismatch', '技能名称在安装过程中发生变化。')
      }
      try {
        await rename(stage, destination)
      } catch (cause) {
        if (cause?.code === 'EEXIST' || cause?.code === 'ENOTEMPTY') {
          throw new SkillStoreError('skill_exists', `技能“${name}”已经存在，请先更换名称。`)
        }
        throw cause
      }
      return summary(parsed ?? verified)
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function parseSkillMarkdown(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_INSTRUCTIONS_BYTES) {
    throw new SkillStoreError('skill_definition_too_large', 'SKILL.md 过大。')
  }
  const text = raw.replace(/^\uFEFF/u, '')
  const matched = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)([\s\S]*)$/u.exec(text)
  if (matched === null) {
    throw new SkillStoreError('skill_frontmatter_missing', 'SKILL.md 缺少 YAML frontmatter。')
  }
  let data
  try {
    data = parseYaml(matched[1], { maxAliasCount: 20, prettyErrors: false })
  } catch {
    throw new SkillStoreError('skill_frontmatter_invalid', 'SKILL.md 的 YAML frontmatter 无效。')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new SkillStoreError('skill_frontmatter_invalid', 'SKILL.md 的 frontmatter 必须是对象。')
  }
  const name = validateName(data.name)
  const description = validateDescription(data.description)
  if ('modelInvocable' in data || 'userInvocable' in data) {
    throw new SkillStoreError('skill_frontmatter_legacy', '请使用 DSH 标准的技能调用字段。')
  }
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (key in data && typeof data[key] !== 'boolean') {
      throw new SkillStoreError('skill_frontmatter_invalid', `frontmatter 字段“${key}”必须是布尔值。`)
    }
  }
  const instructions = validateInstructions(matched[2])
  return { name, description, instructions }
}

export function buildSkillMarkdown({ name, description, instructions }) {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions.trim()}\n`
}

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || !SKILL_NAME.test(name)) {
    throw new SkillStoreError('skill_name_invalid', '技能名称只能使用小写字母、数字和连字符，且不超过 64 个字符。')
  }
  return name
}

function validateDescription(value) {
  const description = typeof value === 'string' ? value.trim() : ''
  if (description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SkillStoreError('skill_description_invalid', '请填写不超过 1024 个字符的技能说明。')
  }
  return description
}

function validateInstructions(value) {
  const instructions = typeof value === 'string' ? value.trim() : ''
  if (instructions.length === 0 || Buffer.byteLength(instructions, 'utf8') > MAX_INSTRUCTIONS_BYTES) {
    throw new SkillStoreError('skill_instructions_invalid', '请填写有效的技能指令，大小不超过 256 KiB。')
  }
  return instructions
}

function summary(parsed) {
  return { name: parsed.name, description: parsed.description, source: 'personal' }
}

function containedPath(root, name) {
  const child = resolve(root, name)
  const rel = relative(resolve(root), child)
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SkillStoreError('skill_path_invalid', '技能路径超出个人技能目录。')
  }
  return child
}

async function copyDirectory(source, destination, budget, depth) {
  if (depth > MAX_BUNDLE_DEPTH) {
    throw new SkillStoreError('skill_bundle_too_deep', '技能文件夹层级过深。')
  }
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destination, entry.name)
    const info = await safeLstat(sourcePath, 'skill_import_unreadable', '技能文件夹包含无法读取的内容。')
    if (info.isSymbolicLink()) {
      throw new SkillStoreError('skill_bundle_symlink', '技能文件夹不能包含符号链接或目录联接。')
    }
    if (info.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o700 })
      await copyDirectory(sourcePath, destinationPath, budget, depth + 1)
      continue
    }
    if (!info.isFile()) {
      throw new SkillStoreError('skill_bundle_entry_invalid', '技能文件夹只能包含普通文件和目录。')
    }
    budget.files += 1
    budget.bytes += info.size
    if (budget.files > MAX_BUNDLE_FILES || budget.bytes > MAX_BUNDLE_BYTES) {
      throw new SkillStoreError('skill_bundle_too_large', '技能文件夹超过 256 个文件或 32 MiB。')
    }
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  }
}

async function safeRead(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new SkillStoreError('skill_definition_unreadable', '所选文件夹缺少可读取的 SKILL.md。')
  }
}

async function safeLstat(path, code, message) {
  try { return await lstat(path) } catch { throw new SkillStoreError(code, message) }
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

function parseSimpleYaml(source) {
  const result = {}
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(?:#.*)?$/u.test(line) || /^\s/u.test(line)) continue
    const matched = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/u.exec(line)
    if (matched === null) throw new Error('unsupported YAML in dependency-free validation mode')
    const [, key, rawValue] = matched
    if (rawValue === 'true' || rawValue === 'false') result[key] = rawValue === 'true'
    else if (rawValue.startsWith('"') && rawValue.endsWith('"')) result[key] = JSON.parse(rawValue)
    else if (rawValue.startsWith("'") && rawValue.endsWith("'")) result[key] = rawValue.slice(1, -1).replace(/''/gu, "'")
    else result[key] = rawValue
  }
  return result
}
