import assert from 'node:assert/strict'
import { repository } from './catalog.mjs'

export function verifyPublicationSource(commit, env) {
  assert.equal(env.GITHUB_REPOSITORY?.toLowerCase(), repository.toLowerCase(), 'Only the source repository may publish')
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Dispatch npm publication from main')
  assert.match(env.SOURCE_COMMIT || '', /^[0-9a-f]{40}$/i, 'Provide the reviewed full source commit SHA')
  assert.equal(env.SOURCE_COMMIT.toLowerCase(), commit, 'Reviewed and checked-out source commits must match')
  assert.equal(env.GITHUB_SHA, commit, 'Workflow and checked-out source commits must match')
}
