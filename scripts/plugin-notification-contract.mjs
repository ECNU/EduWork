import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The new shell no longer interprets old Studio/calendar records. Refuse an
// apparently successful product build with incompatible published consumers.
export async function verifyPluginNotificationConsumers(modules, selected = ['@eduwork/dsh-knowledge-studio', '@eduwork/dsh-desktop-pet']) {
  for (const name of selected.filter(name => ['@eduwork/dsh-knowledge-studio', '@eduwork/dsh-desktop-pet'].includes(name))) {
    const manifest = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))
    if (manifest.eduworkNotificationProtocol !== 1) {
      throw Error(`${name}@${manifest.version} does not support plugin notification protocol 1. Publish the migrated package and update the exact npm lock before product assembly.`)
    }
  }
}
