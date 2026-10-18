// Shared desktop/Web skill projection, including the pinned older npm baseline.
// Node.js port of install-bundled-dsh-skills.ps1.
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { copyTree, ensureDir, fullPath, isDirectory, isFile, pathExists, readJSON, writeText } from './build-util.mjs'

export function resolveDshSkillChild(root, relative) {
  if (!String(relative ?? '').trim() || isAbsolute(relative) || String(relative).split(/[/\\]/).includes('..')) {
    throw new Error('Skill source must stay inside its configured root')
  }
  const parent = fullPath(root).replace(/[\\/]+$/, '')
  const path = fullPath(join(parent, relative))
  const prefix = parent + sep
  const matches = process.platform === 'linux' ? path.startsWith(prefix) : path.toLowerCase().startsWith(prefix.toLowerCase())
  if (!matches) throw new Error('Skill source escapes its configured root')
  return path
}

export async function getDshSkillCapabilities(packageRoot) {
  const shared = join(packageRoot, '@eduwork/dsh-artifact-services')
  const studio = join(packageRoot, '@eduwork/dsh-knowledge-studio/package.json')
  const manifest = await isFile(studio) ? await readJSON(studio) : null
  return {
    imageGeneration: await isFile(join(shared, 'lib/images.js')) && await isFile(join(shared, 'skills/images/SKILL.md')),
    configurableStudioSkills: Array.isArray(manifest?.dshKnowledgeStudio?.capabilities) && manifest.dshKnowledgeStudio.capabilities.includes('configurableSkills'),
  }
}

export async function copyDshBundledSkills({ repository, packageRoot, skillRoot, skills }) {
  const capabilities = await getDshSkillCapabilities(packageRoot)
  const installed = []
  for (const skill of skills) {
    if (skill.requiresPackageCapability) {
      if (skill.requiresPackageCapability !== 'configurableSkills') throw new Error('Unknown package skill capability')
      if (!capabilities.configurableStudioSkills) continue
    }
    let source
    if (skill.sourcePackage) {
      const packagePath = resolveDshSkillChild(packageRoot, skill.sourcePackage)
      source = resolveDshSkillChild(packagePath, skill.sourcePath)
    } else {
      source = resolveDshSkillChild(repository, skill.source)
    }
    let fallback = false
    if (!await isFile(join(source, 'SKILL.md'))) {
      if (!skill.fallback?.source) throw new Error(`Selected bundled Skill is missing SKILL.md: ${source}`)
      source = resolveDshSkillChild(repository, skill.fallback.source)
      fallback = true
    }
    if (!await isFile(join(source, 'SKILL.md'))) throw new Error(`Fallback Skill is missing SKILL.md: ${source}`)
    const target = resolveDshSkillChild(skillRoot, skill.name)
    if (await pathExists(target)) throw new Error(`Skill target already exists in this assembly: ${target}`)
    await ensureDir(skillRoot)
    await copyTree(source, target)
    if (fallback) {
      const path = join(target, 'SKILL.md')
      const content = (await readFile(path, 'utf8')).replace(/^name: .+$/gm, `name: ${skill.name}`)
      await writeText(path, content)
    }
    if (skill.metadata) {
      // Edition metadata changes the binding, never duplicates the Skill's instructions.
      // Older production recipes keep their original metadata and credentials contract.
      const yaml = createRequire(resolve(packageRoot, '..', 'package.json'))('yaml')
      const file = join(target, 'SKILL.md')
      const body = await readFile(file, 'utf8')
      const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)
      if (!header) throw new Error('Skill metadata projection requires YAML frontmatter')
      const value = yaml.parse(header[1])
      value.metadata = JSON.parse(JSON.stringify(skill.metadata))
      await writeText(file, '---\n' + yaml.stringify(value) + '---' + body.slice(header[0].length), { trailingNewline: false })
    }
    if (skill.references !== undefined) {
      if (!Array.isArray(skill.references)) throw new Error('Skill references must be a list')
      const productRoot = dirname(fullPath(skillRoot))
      const prefix = productRoot + sep
      const links = skill.references.map(reference => {
        if (typeof reference.title !== 'string' || !reference.title.trim() || /[\r\n]/.test(reference.title)
          || typeof reference.path !== 'string' || !reference.path || /^[a-z][a-z0-9+.-]*:/i.test(reference.path) || isAbsolute(reference.path) || /[<>\r\n]/.test(reference.path)) throw new Error('Invalid Skill reference')
        const linkPath = reference.path.replaceAll('\\', '/')
        const destination = resolve(target, linkPath)
        const contained = process.platform === 'linux' ? destination.startsWith(prefix) : destination.toLowerCase().startsWith(prefix.toLowerCase())
        if (!contained) throw new Error('Skill reference escapes the product')
        const title = reference.title.replace(/[\\[\]]/g, '\\$&')
        return `- [${title}](<${linkPath}>)`
      })
      if (links.length) {
        const file = join(target, 'SKILL.md')
        await writeText(file, (await readFile(file, 'utf8')).trimEnd() + '\n\n## 发行版参考资料\n\n' + links.join('\n') + '\n')
      }
    }
    console.log(String(skill.name))
    installed.push(String(skill.name))
  }
  // Shared creation guidance is read both by the Studio planner and by the
  // projected file skills. Preserve their sibling reference paths without
  // registering the reference directory as another user-facing skill.
  if (skills.some(skill => skill.sourcePackage === '@eduwork/dsh-artifact-services')) {
    const sharedPackage = resolveDshSkillChild(packageRoot, '@eduwork/dsh-artifact-services')
    const references = resolveDshSkillChild(sharedPackage, 'skills/shared')
    if (await isDirectory(references)) {
      const hasSkillManifest = async directory => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isDirectory() && await hasSkillManifest(join(directory, entry.name))) return true
          if (entry.isFile() && entry.name === 'SKILL.md') return true
        }
        return false
      }
      if (await hasSkillManifest(references)) throw new Error('Shared references must not register another Skill')
      const referenceTarget = resolveDshSkillChild(skillRoot, 'shared')
      if (await pathExists(referenceTarget)) throw new Error(`Shared Skill references already exist: ${referenceTarget}`)
      await copyTree(references, referenceTarget)
    }
  }
  return installed
}

export async function setDshMediaCompatibility(patchPath, capabilities) {
  if (capabilities.imageGeneration || !await pathExists(patchPath)) return
  const text = (await readFile(patchPath, 'utf8')).replaceAll('\r\n', '\n')
  const pattern = /^([ \t]*)name: '@chatecnu-work\/dsh-tool-ecnu-media'\n\1config:\n/gm
  const replaced = text.replace(pattern, match => {
    const indent = /^[ \t]*/.exec(match)[0]
    return match + indent + '  legacyTools: true\n'
  })
  await writeText(patchPath, replaced)
}
