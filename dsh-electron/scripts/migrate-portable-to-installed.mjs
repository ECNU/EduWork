import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { migratePortableToInstalled } from '../src/portable-migration.mjs'

export { migratePortableToInstalled }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'win32') throw new Error('Portable migration CLI is only supported on Windows')
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, 'target-root': { type: 'string' }, 'writable-root': { type: 'string' }, 'dry-run': { type: 'boolean' },
  } })
  if (!values.source || !values['target-root'] || !values['writable-root']) {
    throw new Error('Use --source <old-program-root> --target-root <installed-program-root> --writable-root <W> [--dry-run]; the source is moved aside during migration and restored on failure')
  }
  const result = await migratePortableToInstalled({ sourceRoot: values.source, targetRoot: values['target-root'],
    writableRoot: values['writable-root'], dryRun: Boolean(values['dry-run']) })
  console.log(JSON.stringify(result, null, 2))
}
