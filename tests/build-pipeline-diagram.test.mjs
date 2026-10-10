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
import { sharedDesktopStages } from '../scripts/lib/shared-desktop-stages.mjs'
import { macosStages } from '../scripts/lib/macos-stages.mjs'
import { windowsStages } from '../scripts/lib/windows-stages.mjs'

const coreRoot = join(import.meta.dirname, '..')

test('the checked-in diagrams match the stage declarations', async () => {
  const output = await mkdtemp(join(tmpdir(), 'l5-diagrams-'))
  try {
    await buildPipelineDiagrams({ output })
    const assets = join(coreRoot, 'docs/assets')
    // The rendered .svg is checked in beside the sources, so it is compared
    // exactly like the text forms. A hand-exported raster could not be, which is
    // how the previous .png drifted away from the stages it claimed to show.
    for (const name of ['build-pipeline.svg', 'build-pipeline.drawio', 'build-pipeline.mmd',
      'build-pipeline-macos.json', 'build-pipeline-windows.json']) {
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

test('the rendered svg names every stage once and explains it in Chinese', async () => {
  const output = await mkdtemp(join(tmpdir(), 'l5-diagrams-svg-'))
  try {
    const written = await buildPipelineDiagrams({ output })
    assert.ok(written.includes('build-pipeline.svg'), 'the svg is not an emitted asset')
    const svg = await readFile(join(output, 'build-pipeline.svg'), 'utf8')
    assert.match(svg, /EduWork 双平台桌面构建流程/)
    const common = {
      coreRoot,
      editionRoot: coreRoot,
      distributionConfig: 'config/distributions/generic.json',
      version: '0.0.0',
      verifySnapshot: true,
      runtimeSource: '',
      upstreamSource: '',
    }
    const stages = [
      ...sharedDesktopStages(common),
      ...macosStages({
        coreRoot, name: 'EduWork', version: '0.0.0', development: true, releaseNotesFile: '', receiptBase: {},
      }),
      ...windowsStages({ coreRoot, receiptBase: {} }),
    ]
    // A stage that is declared but not drawn would be a picture that quietly
    // disagrees with the pipeline.
    for (const entry of stages) {
      assert.ok(svg.includes(`>${entry.name}</text>`), `${entry.name} is missing from the svg`)
    }
    assert.equal(svg.match(/>web<\/text>/g)?.length, 1, 'shared stages must appear once')
    assert.equal(svg.match(/>sparkle<\/text>/g)?.length, 1, 'the macOS branch must appear once')
    assert.match(svg, /构建 Web 产品/)
    assert.match(svg, /准备 Mac 更新/)
    assert.match(svg, /仅 macOS/)
    assert.match(svg, / d="M\d+ \d+ C/)
    assert.doesNotMatch(svg, />可并行</)
    assert.doesNotMatch(svg, /\bin \d|\bout \d|mutable output/)
    const mermaid = await readFile(join(output, 'build-pipeline.mmd'), 'utf8')
    assert.equal(mermaid.match(/--- join/g)?.length, 5, 'the package must show each prerequisite')
    assert.match(mermaid, /join --> desktop/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
