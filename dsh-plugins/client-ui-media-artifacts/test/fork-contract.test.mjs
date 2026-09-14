import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const source = fs.readFileSync(path.join(root, 'src', 'client', 'deliverables.js'), 'utf8')
const tracker = fs.readFileSync(path.join(root, 'src', 'client', 'produced-file-tracker.js'), 'utf8')

test('artifact UI declares the exact alpha5 deliverables replacement contract', () => {
  assert.equal(manifest.chatecnuWork.kind, 'compat-plugin')
  assert.deepEqual(manifest.chatecnuWork.replaces, ['@deepseek-ai/dsh-client-ui-deliverables'])
  assert.equal(manifest.chatecnuWork.contractVersion, 'dsh-client-ui-deliverables@0.1.2-rc.1')
  assert.equal(manifest.chatecnuWork.upstreamCommit, 'a66e4702047846cdaa10c66c9d3df3951f5ea70d')
  assert.match(manifest.chatecnuWork.sunsetWhen, /produced-file rendering and preview action slots/u)
})

test('artifact UI retains the upstream event-derived deliverable facts', () => {
  assert.match(source, /event\.type === 'tool\/result' && isAppendSurfaceEvent\(event\)/u)
  assert.match(source, /if \(result\.isError === true\) return context\.state/u)
  assert.match(tracker, /case 'write'/u)
  assert.match(tracker, /case 'edit'/u)
  assert.match(tracker, /case 'str_replace_editor'/u)
  assert.match(source, /trackedArtifactCall\(match\.event\.data\.name, match\.event\.data\.arguments\)/u)
  assert.match(source, /successfulArtifactPaths\(context\.state\.calls\.get\(callId\), match\.event\.data\.meta\)/u)
  assert.doesNotMatch(source, /match\.view/u)
  assert.match(source, /producedForClosing\(owner\.turn\.data\.get\('deliverables'\), owner\.seq\)/u)
  assert.doesNotMatch(source, /assistant.*content.*path|model.*prose.*path/iu)
})

test('artifact UI temporarily shadows the official details slot and restores it on close', () => {
  assert.match(source, /name: 'details', priority: -100/u)
  assert.match(source, /previewDetailsActivation\?\.activate\(\)/u)
  assert.match(source, /previewDetailsActivation\?\.deactivate\(\)/u)
  assert.doesNotMatch(source, /conversation\.details\.artifact/u)
  assert.match(source, /MarkdownText/u)
  assert.match(source, /shortestUniqueLabels/u)
  assert.match(source, /再显示 \$\{hidden\} 个/u)
  assert.doesNotMatch(source, /增删行|撤销变更|代码审查/u)
})

test('artifact Markdown preview supplies the complete alpha5 primitive labels contract', () => {
  assert.match(source, /const artifactMarkdownLabels = Object\.freeze/u)
  assert.match(source, /code: Object\.freeze\(\{ copyLabel: '复制代码', copiedLabel: '已复制' \}\)/u)
  assert.match(source, /footnotes: '脚注'/u)
  assert.match(source, /h\(MarkdownText, \{ text: preview\.data, labels: artifactMarkdownLabels \}\)/u)
})
