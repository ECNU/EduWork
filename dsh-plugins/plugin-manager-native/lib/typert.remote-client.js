import { actionSchema, jobIDSchema, jobResult, jsonParameter, pickerResult, restartResult, snapshotResult, valueSchema } from './typert-schemas.js'
const pkg = '@chatecnu-work/dsh-plugin-manager-native'
const source = { file: 'dsh-plugins/plugin-manager-native/lib/index.js', line: 1, column: 1 }
const parameter = (name, schema) => jsonParameter(name, schema, `${pkg}#${name}`)
const descriptor = (method, parameters, result) => ({ id: `${pkg}#productPluginManager/${method}`, service: 'productPluginManager', namespace: 'productPluginManager', method, invocation: { kind: 'direct' }, parameters, result, sourceLocation: source })
export const TYPERT_REMOTE = { package: pkg, descriptors: [
  descriptor('list', [], snapshotResult), descriptor('selectFile', [], pickerResult), descriptor('selectDirectory', [], pickerResult),
  descriptor('start', [parameter('action', actionSchema), parameter('value', valueSchema)], jobResult),
  descriptor('job', [parameter('jobID', jobIDSchema)], jobResult), descriptor('restart', [], restartResult),
] }
export default TYPERT_REMOTE
