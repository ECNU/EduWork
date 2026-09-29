// The diagrams are generated from the stage declarations, so a checked-in copy
// that no longer matches them is stale documentation. The previous hand-drawn
// diagrams had already drifted (both stated a file count that was wrong by 70),
// which is exactly what this prevents.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPipelineDiagrams } from '../scripts/build-pipeline-diagram.mjs'
import { maxParallelism, parallelSets } from '../scripts/lib/stage-runner.mjs'
import { sharedDesktopStages } from '../scripts/lib/shared-desktop-stages.mjs'
import { macosStages } from '../scripts/lib/macos-stages.mjs'

const coreRoot = join(import.meta.dirname, '..')

test('the checked-in diagrams match the stage declarations', async () => {
  const output = await mkdtemp(join(tmpdir(), 'l5-diagrams-'))
  try {
    await buildPipelineDiagrams({ output })
    const assets = join(coreRoot, 'docs/assets')
    for (const name of ['build-pipeline-macos.drawio', 'build-pipeline-macos.mmd', 'build-pipeline-macos.json',
      'build-pipeline-windows.drawio', 'build-pipeline-windows.mmd', 'build-pipeline-windows.json']) {
      const [generated, checkedIn] = await Promise.all([
        readFile(join(output, name), 'utf8'),
        readFile(join(assets, name), 'utf8').catch(() => null),
      ])
      assert.ok(checkedIn !== null, `${name} is missing from docs/assets; run the generator`)
      assert.equal(checkedIn, generated, `${name} is stale; re-run scripts/build-pipeline-diagram.mjs`)
    }
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('every dependency edge points to an earlier wave', () => {
  const common = {
    coreRoot,
    editionRoot: coreRoot,
    distributionConfig: 'config/distributions/generic.json',
    version: '0.0.0',
    verifySnapshot: true,
    runtimeSource: '',
    upstreamSource: '',
  }
  const stages = [...sharedDesktopStages(common), ...macosStages({
    coreRoot, name: 'EduWork', version: '0.0.0', development: true, releaseNotesFile: '', receiptBase: {},
  })]
  const waves = parallelSets(stages)
  const waveOf = new Map()
  waves.forEach((wave, index) => wave.forEach(name => waveOf.set(name, index)))
  for (const entry of stages) {
    for (const dependency of [...entry.requires, ...entry.dependsOn]) {
      assert.ok(
        waveOf.get(dependency) < waveOf.get(entry.name),
        `${dependency} -> ${entry.name} does not advance a wave`,
      )
    }
  }
})

test('the declared width is at least two, so parallelism is not vacuous', () => {
  const common = {
    coreRoot,
    editionRoot: coreRoot,
    distributionConfig: 'config/distributions/generic.json',
    version: '0.0.0',
    verifySnapshot: true,
    runtimeSource: '',
    upstreamSource: '',
  }
  const stages = [...sharedDesktopStages(common), ...macosStages({
    coreRoot, name: 'EduWork', version: '0.0.0', development: true, releaseNotesFile: '', receiptBase: {},
  })]
  assert.ok(maxParallelism(stages) >= 2, 'the pipeline has no stage that can overlap another')
})
