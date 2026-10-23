/**
 * What the plugin and its settings page share: the wire descriptors of the
 * page's methods (the Host Gateway validates calls with them and the page
 * mounts its remote client from them) and the DSH credential holding the
 * relay access key.
 */
import { z } from 'zod'

const pkg = '@eduwork/dsh-remote-access'

/** The DSH credential the page stores the access key in, kept out of the plugin's settings. */
export const ACCESS_KEY_REF = 'EDUWORK_REMOTE_ACCESS_KEY'

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
