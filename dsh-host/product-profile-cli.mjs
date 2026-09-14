import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { prepareProductProfile } from './product-profile.mjs'

const { values } = parseArgs({ options: {
  product: { type: 'string' }, home: { type: 'string' }, shell: { type: 'string' }, 'private-config': { type: 'string' },
  'user-config': { type: 'string' },
} })
if (!values.product || !values.home || !values.shell) throw new Error('Use --product <directory> --home <isolated home> --shell <wails|electron>')
try {
  const launch = values['private-config'] ? JSON.parse(await readFile(values['private-config'], 'utf8')) : {}
  const result = await prepareProductProfile({ product: values.product, home: values.home, shell: values.shell,
    pluginConfig: launch.pluginConfig, patches: launch.patches, enterpriseProfile: launch.enterpriseProfile, userConfig: values['user-config'] })
  // The native parent reads this control response. Credential values and the
  // private launch environment are deliberately not part of the response.
  process.stdout.write(JSON.stringify(result) + '\n')
} catch (error) {
  // Keep UTF-8 diagnostics readable in the startup page, without Node internals.
  process.stderr.write(String(error.message || error) + '\n')
  process.exitCode = 1
}
