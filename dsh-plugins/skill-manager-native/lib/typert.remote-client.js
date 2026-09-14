import {
  createInputSchema, jsonParameter, skillListResult, skillNameSchema, skillSummaryResult, sourcePathSchema,
} from './typert-schemas.js'

const pkg = '@chatecnu-work/dsh-skill-manager-native'
const source = { file: 'dsh-plugins/skill-manager-native/lib/index.js', line: 1, column: 1 }
const descriptor = (method, parameters, result) => ({
  id: `${pkg}#skillManager/${method}`,
  service: 'skillManager', namespace: 'skillManager', method,
  invocation: { kind: 'direct' }, parameters, result, sourceLocation: source,
})

export const TYPERT_REMOTE = {
  package: pkg,
  descriptors: [
    descriptor('list', [], skillListResult),
    descriptor('create', [jsonParameter('input', createInputSchema, `${pkg}#CreateInput`)], skillSummaryResult),
    descriptor('importDirectory', [jsonParameter('sourcePath', sourcePathSchema, `${pkg}#SourcePath`)], skillSummaryResult),
    descriptor('trashPersonalSkill', [jsonParameter('name', skillNameSchema, `${pkg}#SkillName`)], skillSummaryResult),
  ],
}

export default TYPERT_REMOTE
