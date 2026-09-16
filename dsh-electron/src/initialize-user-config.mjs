import { constants } from 'node:fs'
import { copyFile, cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The app bundle is a read-only template. Never replace a user's active config
// or example files when the application is upgraded.
export async function initializeUserConfig({ product, config }) {
  const source = join(product, 'resources/desktop')
  await mkdir(dirname(config), { recursive: true })
  try {
    await copyFile(join(source, 'eduwork.jsonc'), config, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  await cp(join(source, 'examples'), join(dirname(config), 'examples'), {
    recursive: true, force: false, errorOnExist: false,
  })
}
