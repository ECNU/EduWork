import { z } from 'zod'

const nullableString = z.string().nullable()
const release = z.object({
  productVersion: z.string(), dshVersion: z.string(), dshCommit: nullableString,
  nodeVersion: z.string(), pnpmVersion: nullableString,
  packageFlavor: nullableString,
  distributionMode: z.enum(['desktop-release', 'web-or-source']),
}).strict()
const runtimeComponent = z.object({
  id: z.string(), category: z.enum(['platform', 'runtime', 'capability']), version: nullableString,
  status: z.enum(['ready', 'available', 'not-initialized', 'missing', 'unavailable']),
  source: z.enum(['release-bundled', 'managed-data', 'offline-seed', 'network-managed', 'source', 'system']),
  path: nullableString, dependencies: z.array(z.string()), consumers: z.array(z.string()),
  metadata: z.array(z.object({ key: z.string(), value: z.string() }).strict()),
}).strict()
export const componentSnapshotResult = Object.freeze({
  mode: 'strict', typeSymbol: '@chatecnu-work/dsh-component-inventory-native#ComponentSnapshot',
  schema: z.object({ release, components: z.array(runtimeComponent) }).strict(),
})
