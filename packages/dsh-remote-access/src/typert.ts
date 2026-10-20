/**
 * Wire descriptors of the settings page's methods: the Host Gateway validates
 * calls with them and the page mounts its remote client from them.
 */
import { z } from 'zod'

const pkg = '@eduwork/dsh-remote-access'

const codec = (name: string, schema: z.ZodType) => Object.freeze({
  mode: 'strict', create() { return this.schema }, typeSymbol: `${pkg}#${name}`, schema,
})
const parameter = (name: string, schema: z.ZodType) => Object.freeze({ name, wire: name, source: 'json', codec: codec(name, schema) })
const method = (name: string, parameters: readonly ReturnType<typeof parameter>[] = []) => ({
  id: `${pkg}#remoteDevices/${name}`, service: 'remoteDevices', namespace: 'remoteDevices', method: name,
  invocation: { kind: 'direct' }, parameters, result: codec('PanelStatus', z.unknown()),
  sourceLocation: { file: 'lib/index.js', line: 1, column: 1 },
})

export const descriptors = [
  method('status'),
  method('createInvite'),
  method('cancelInvite'),
  method('decide', [parameter('key', z.string()), parameter('approved', z.boolean())]),
  method('revoke', [parameter('key', z.string())]),
]

export const TYPERT = { package: pkg, face: 'host', schemas: [], invocations: descriptors, model: { services: [], events: [], objects: [] } }
export default TYPERT
