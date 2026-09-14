import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizedPath, previewActionLabel, previewModeLabel, previewSupport, shortestUniqueLabels } from '../src/client/deliverable-utils.js'

test('produced-file labels keep the shortest suffix that distinguishes duplicate names', () => {
  const paths = ['docs/README.md', 'examples/README.md', 'report.pdf']
  assert.deepEqual(shortestUniqueLabels(paths), ['docs/README.md', 'examples/README.md', 'report.pdf'])
  assert.equal(normalizedPath('docs\\README.md'), 'docs/README.md')
})

test('preview policy separates rendered previews and text/source viewers', () => {
  assert.equal(previewSupport('report.pdf'), 'rendered')
  assert.equal(previewSupport('README.md'), 'rendered')
  assert.equal(previewSupport('data.json'), 'text')
  assert.equal(previewSupport('src/app.ts'), 'source')
  assert.equal(previewSupport('page.html'), 'rendered')
  assert.equal(previewSupport('report.docx'), 'rendered')
  assert.equal(previewSupport('book.xlsx'), 'rendered')
  assert.equal(previewSupport('slides.pptx'), 'rendered')
  assert.equal(previewActionLabel('report.docx'), '预览')
  assert.equal(previewModeLabel('src/app.ts'), '源码查看')
})
