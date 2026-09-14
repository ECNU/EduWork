import { z } from 'zod'

const pkg = '@eduwork/dsh-knowledge-studio'
const source = { file: 'lib/index.js', line: 1, column: 1 }
const codec = (typeSymbol: string, schema: z.ZodType = z.unknown()) => ({ mode: 'strict', typeSymbol: `${pkg}#${typeSymbol}`, schema })
const parameter = (name: string, schema: z.ZodType = z.string()) => ({ name, wire: name, source: 'json', codec: codec(name, schema) })
const descriptor = (method: string, parameters: unknown[] = []) => ({
  id: `${pkg}#knowledgeStudio/${method}`, service: 'knowledgeStudio', namespace: 'knowledgeStudio', method,
  invocation: { kind: 'direct' }, parameters, result: codec('Result'), sourceLocation: source,
})
const p = parameter
const unknown = (name: string) => parameter(name, z.unknown())

export const knowledgeStudioRemote = {
  package: pkg,
  descriptors: [
    descriptor('readUIPreferences'),
    descriptor('setUIOpenPreference', [p('open', z.boolean())]),
    descriptor('workspaceForPath', [p('path')]),
    descriptor('workspaceStatus', [p('workspaceId')]),
    descriptor('listCapabilities'),
    descriptor('readEvidence', [p('workspaceId'), p('evidenceId')]),
    descriptor('invokeStudio', [p('workspaceId'), p('capabilityId'), unknown('parameters'), p('sessionId')]),
    descriptor('listArtifacts', [p('workspaceId')]),
    descriptor('readArtifact', [p('artifactId')]),
    descriptor('updateArtifactInteraction', [p('artifactId'), p('action'), p('itemId'), unknown('value')]),
    descriptor('artifactAskPrompt', [p('artifactId'), p('itemId')]),
    descriptor('manageArtifact', [p('artifactId'), p('action'), p('value'), p('sessionId')]),
    descriptor('exportArtifact', [p('artifactId'), p('format')]),
  ],
}
