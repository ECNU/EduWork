// Collect evidence from the supported pinned desktop recipe.
import { join } from 'node:path'
import { copyFileTo, isFile } from './build-util.mjs'

/** Copy the public Web evidence into the release evidence directory. */
export async function copyPublicWebEvidence(workspace, destination) {
  for (const [source, target] of [
    ['source-audit/core.json', 'core-source-audit.json'],
    ['source-report/client-build.json', 'client-build.json'],
  ]) {
    const file = workspace.resolvePath(source)
    if (await isFile(file)) await copyFileTo(file, join(destination, target))
  }
}
