import { join } from 'node:path'
import { copyProductTree } from './portable-product-links.mjs'

/** Project file skills without breaking their sibling reference paths. */
export async function copySourceSkills({ repository, packages, skills, output }) {
  for (const skill of skills) {
    const source = skill.sourcePackage
      ? join(packages, skill.sourcePackage, skill.sourcePath)
      : join(repository, skill.source)
    await copyProductTree(source, join(output, skill.name))
  }
  if (skills.some(skill => skill.sourcePackage === '@eduwork/dsh-artifact-services')) {
    // Reference-only content: keep it beside the skills, not another registered skill.
    await copyProductTree(join(packages, '@eduwork/dsh-artifact-services/skills/shared'), join(output, 'shared'))
  }
}
