import {z} from 'zod'
const pkg = '@eduwork/dsh-external-agents'
export const entrySchema = z.object({id: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), name: z.string().min(1).max(80), kind: z.enum(['codex', 'acp']), command: z.string().max(4096).nullable(), args: z.array(z.string().max(4096)).max(32), enabled: z.boolean()}).strict()
const row = entrySchema.extend({installed: z.boolean(), checked: z.boolean(), message: z.string()})
const request = z.discriminatedUnion('op', [
  z.object({op: z.literal('list')}),
  z.object({op: z.literal('remove'), id: z.string()}),
  z.object({op: z.literal('check'), id: z.string()}),
  z.object({op: z.literal('enable'), id: z.string(), enabled: z.boolean()}),
  z.object({op: z.literal('add'), name: z.string().min(1).max(80), command: z.string().min(1).max(4096), args: z.array(z.string().max(4096)).max(32)}),
])
const codec = (name, schema) => ({mode: 'strict', typeSymbol: `${pkg}#${name}`, schema, create: () => schema})
export const descriptors = [{id: `${pkg}#eduworkAgentConnections/manage`, service: 'eduworkAgentConnections', namespace: 'eduworkAgentConnections', method: 'manage', invocation: {kind: 'direct'}, parameters: [{name: 'request', wire: 'request', source: 'json', codec: codec('Request', request)}], result: codec('Result', z.object({rows: z.array(row)})), sourceLocation: {file: 'src/connections.js', line: 1, column: 1}}]
export const TYPERT = {package: pkg, face: 'host', schemas: [], invocations: descriptors, model: {services: [], events: [], objects: []}}
export default {package: pkg, descriptors}
