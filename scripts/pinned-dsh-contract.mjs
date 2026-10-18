import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { desktopBuildPlan } from './desktop-build-plan.mjs'

// Assembly stages share the selected, repository-contained source lock. The
// separate source hashes still verify every upstream file before adaptation.
const core = fileURLToPath(new URL('../', import.meta.url))
const plan = await desktopBuildPlan({ core, version: '0.0.0' })
export const pinnedDshDirectory = plan.candidate
export const pinnedDshContract = JSON.parse(await readFile(plan.sourceLock, 'utf8'))
export function verifyPinnedDshReceipt(receipt) {
  assert.equal(receipt.dshVersion, pinnedDshContract.packageVersion, 'Unqualified Runtime version')
  assert.equal(receipt.dshCommit, pinnedDshContract.commit, 'Unqualified Runtime source')
}
