import { z } from 'zod'

export const actionSchema = z.enum(['add-registry', 'import-path', 'update', 'remove'])
export const valueSchema = z.string().min(1).max(4096)
export const jobIDSchema = z.string().uuid()
const pluginSchema = z.object({
  name: z.string(), requested: z.string(), version: z.string().nullable(),
  source: z.enum(['registry', 'local-directory', 'local-archive', 'unknown-local']), sourcePath: z.string().nullable(),
  bundle: z.boolean(), enabled: z.boolean(), updateable: z.boolean(),
}).strict()
const snapshotSchema = z.object({ profile: z.string(), packages: z.array(pluginSchema) }).strict()
export const snapshotResult = Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol: '@chatecnu-work/dsh-plugin-manager-native#PluginSnapshot', schema: snapshotSchema })
export const pickerResult = Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol: '@chatecnu-work/dsh-plugin-manager-native#PickerResult', schema: z.object({ path: z.string() }).strict() })
export const restartResult = Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol: '@chatecnu-work/dsh-plugin-manager-native#RestartResult', schema: z.object({ restarting: z.literal(true) }).strict() })
export const jobResult = Object.freeze({
  mode: 'strict', create() { return this.schema }, typeSymbol: '@chatecnu-work/dsh-plugin-manager-native#PluginJob',
  schema: z.object({
    id: z.string().uuid(), state: z.enum(['running', 'succeeded', 'failed']), action: actionSchema,
    packageName: z.string().nullable(), message: z.string(), output: z.string(), requiresRestart: z.boolean(), snapshot: snapshotSchema.nullable(),
  }).strict(),
})
export function jsonParameter(name, schema, typeSymbol) {
  return Object.freeze({ name, wire: name, source: 'json', codec: Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol, schema }) })
}
