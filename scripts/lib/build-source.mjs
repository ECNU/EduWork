import { join } from 'node:path'
import { sourceFileSet } from '../audit-eduwork-distribution.mjs'
import { capture, sha256File, sha256Text } from './build-util.mjs'

/** Bind a desktop workspace to the actual source bytes and checked-out commits. */
export async function desktopSourceIdentity({ coreRoot, editionRoot = coreRoot }) {
  const identify = async root => ({
    commit: await capture('git', ['-C', root, 'rev-parse', 'HEAD']),
    fileSetSHA256: sha256Text(JSON.stringify(sourceFileSet(root))),
    receiptSHA256: await sha256File(join(root, 'source-receipt.json')),
  })
  const core = await identify(coreRoot)
  const edition = coreRoot === editionRoot ? core : await identify(editionRoot)
  return { core, edition }
}
