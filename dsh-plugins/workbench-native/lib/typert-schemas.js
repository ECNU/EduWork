import { z } from 'zod'
const pkg = '@eduwork/workbench-native'
const codec = (name, schema) => ({ mode: 'strict', create() { return this.schema }, typeSymbol: `${pkg}#${name}`, schema })
const row = z.object({ name: z.string(), description: z.string(), source: z.enum(['builtin','personal']), available: z.boolean(), requirement: z.string(), removable: z.boolean() }).strict()
const update = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
const importJob = codec('ImportJob', z.object({ id: z.string(), state: z.enum(['idle','scanning','ready','running','complete','error']), message: z.string(), total: z.number(), completed: z.number(), imported: z.number(), skipped: z.number(), conflicts: z.number(), files: z.number(), warnings: z.array(z.string()), report: z.string(), source: z.string(), sourceVersion: z.string(), targetFormat: z.number(), formats: z.array(z.number()), scanned: z.number(), found: z.number(), excluded: z.number(), olderCopies: z.number(), failed: z.number(), issues: z.array(z.object({ path: z.string(), category: z.enum(['unsupported','invalid']), reason: z.string() }).strict()) }).strict())
export const descriptors = [
  ['inspectImport', [{ name: 'path', wire: 'path', source: 'json', codec: codec('ImportPath', z.string().min(1)) }], importJob],
  ['cancelImport', [], importJob],
  ['importData', [{ name: 'path', wire: 'path', source: 'json', codec: codec('ImportPath', z.string().min(1)) }], importJob],
  ['importStatus', [], importJob],
  ['catalog', [], codec('Catalog', z.object({ skills: z.array(row) }).strict())],
  ['desktop', [{ name: 'action', wire: 'action', source: 'json', codec: codec('Action', z.enum(['status','check-updates','diagnostics','download-update','schedule-update','install-update','use-stable-updates','use-development-updates','download-content-update','restart-content-update'])) }], codec('Desktop', z.object({ shell: z.string(), phase: z.string(), message: z.string(), version: z.string().optional(), url: z.string().optional(), report: z.string().optional(), archive: z.string().optional(), filename: z.string().optional(), update, contentUpdate: update }).strict())],
].map(([method, parameters, result]) => ({ id: `${pkg}#workbench/${method}`, service: 'workbench', namespace: 'workbench', method, invocation: { kind: 'direct' }, parameters, result, sourceLocation: { file: 'lib/index.js', line: 1, column: 1 } }))
