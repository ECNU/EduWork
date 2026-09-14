import {
  deleteResult,
  exportResult,
  importResult,
  listResult,
  singleDeleteResult,
  statsResult,
  stringParameter,
  undoDeleteResult,
  updateResult,
} from './typert-schemas.js'

const pkg = '@eduwork/dsh-memory'
const source = { file: 'src/host/index.js', line: 1, column: 1 }
const descriptor = (method, parameters, result) => ({
  id: `${pkg}#localMemories/${method}`,
  service: 'localMemories',
  namespace: 'localMemories',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result,
  sourceLocation: source,
})

export const MEMORY_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor('stats', [], statsResult),
  descriptor('listRecords', [stringParameter('request', 8_192, `${pkg}#MemoryListRequest`)], listResult),
  descriptor('updateRecord', [stringParameter('request', 8_192, `${pkg}#MemoryUpdateRequest`)], updateResult),
  descriptor('setRecordPinned', [stringParameter('request', 8_192, `${pkg}#MemoryRetentionRequest`)], updateResult),
  descriptor('undoRecordUpdate', [stringParameter('id', 256, `${pkg}#MemoryId`)], updateResult),
  descriptor('deleteRecord', [stringParameter('request', 8_192, `${pkg}#MemoryDeleteRequest`)], singleDeleteResult),
  descriptor('undoDelete', [stringParameter('token', 128, `${pkg}#MemoryUndoToken`)], undoDeleteResult),
  descriptor('deleteAll', [stringParameter('confirmation', 64, `${pkg}#DeleteConfirmation`)], deleteResult),
  descriptor('exportData', [], exportResult),
  descriptor('importData', [stringParameter('document', 8_000_000, `${pkg}#MemoryImportDocument`)], importResult),
])

export const TYPERT = {
  package: pkg,
  face: 'host',
  schemas: [],
  invocations: MEMORY_REMOTE_DESCRIPTORS,
  model: { services: [], events: [], objects: [] },
}
