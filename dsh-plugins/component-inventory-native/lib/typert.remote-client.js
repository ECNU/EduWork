import { componentSnapshotResult } from './typert-schemas.js'
const pkg = '@chatecnu-work/dsh-component-inventory-native'
const descriptor = { id: `${pkg}#productComponents/list`, service: 'productComponents', namespace: 'productComponents', method: 'list', invocation: { kind: 'direct' }, parameters: [], result: componentSnapshotResult, sourceLocation: { file: 'dsh-plugins/component-inventory-native/lib/index.js', line: 1, column: 1 } }
export const TYPERT_REMOTE = { package: pkg, descriptors: [descriptor] }
export default TYPERT_REMOTE
