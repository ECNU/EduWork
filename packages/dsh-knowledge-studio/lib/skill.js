import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillURL = new URL('../skills/knowledge-studio/SKILL.md', import.meta.url)
const skillPath = fileURLToPath(skillURL)

function bodyOf(raw) {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

export function installKnowledgeStudioSkill(ctx) {
  const raw = readFileSync(skillURL, 'utf8')
  const content = bodyOf(raw)
  return ctx.skills.register({
    name: 'knowledge-studio',
    description: raw.match(/^description: (.+)$/m)[1].trim(),
    whenToUse: raw.match(/^whenToUse: (.+)$/m)[1].trim(),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    path: skillPath,
    resourceBase: { kind: 'directory', path: dirname(skillPath) },
    content,
  })
}
