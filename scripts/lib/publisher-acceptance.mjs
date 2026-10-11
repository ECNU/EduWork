import assert from 'node:assert/strict'
import { contentUpdateSource } from '../../dsh-host/content-update-protocol.mjs'

// The packaged descriptor defines which signed components the first launch
// must activate. Bundled skills do not require a downloaded skill revision.
export function verifyPublisherFirstLaunch(descriptor, started) {
  const source = contentUpdateSource(descriptor?.contentUpdates)
  assert.ok(source && (source.configuration || source.skills), 'Publisher acceptance requires an enabled content source')
  for (const component of ['configuration', 'skills']) {
    if (!source[component]) continue
    const revision = started?.[`${component}Revision`]
    assert.ok(Number.isSafeInteger(revision) && revision > 0,
      `First launch did not activate signed publisher ${component}`)
  }
}
