import test from 'node:test'
import assert from 'node:assert/strict'
import {
  artifactCardProfile, artifactPathFromBlock, basename, extension, fileVisual, isPreviewable, parentPath,
} from '../src/client/deliverable-utils.js'

test('file helpers support Windows and POSIX paths', () => {
  assert.equal(basename('reports\\final.docx'), 'final.docx')
  assert.equal(basename('reports/final.docx'), 'final.docx')
  assert.equal(extension('reports/final.DOCX'), 'docx')
  assert.equal(parentPath('reports\\final.docx'), 'reports')
  assert.equal(parentPath('final.docx'), '.')
})

test('preview and file visuals are extension driven', () => {
  assert.equal(isPreviewable('final.docx'), true)
  assert.equal(isPreviewable('final.xlsx'), true)
  assert.equal(isPreviewable('final.pptx'), true)
  assert.equal(isPreviewable('page.html'), true)
  assert.equal(isPreviewable('notes.md'), true)
  assert.equal(isPreviewable('movie.mp4'), true)
  assert.deepEqual(fileVisual('final.xlsx'), { glyph: 'X', tone: '#287a4b', label: 'Excel 工作簿' })
  assert.deepEqual(fileVisual('voice.ogg'), { glyph: '声', tone: '#9a5c24', label: '音频' })
  assert.deepEqual(fileVisual('voice.opus'), { glyph: '声', tone: '#9a5c24', label: '音频' })
  assert.deepEqual(fileVisual('voice.aac'), { glyph: '声', tone: '#9a5c24', label: '音频' })
  assert.deepEqual(fileVisual('voice.flac'), { glyph: '声', tone: '#9a5c24', label: '音频' })
  assert.equal(fileVisual('archive.bin').glyph, 'BIN')
})

test('published artifact cards derive their identity from the actual file', () => {
  const cases = [
    ['report.DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word 文档', 'W', 'office'],
    ['book.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel 工作簿', 'X', 'office'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint 演示文稿', 'P', 'office'],
    ['paper.pdf', 'application/pdf', 'PDF 文档', 'PDF', 'office'],
    ['cover.webp', 'image/webp', '生成的图片', '图', 'image'],
    ['voice.flac', 'audio/flac', '生成的音频', '声', 'audio'],
    ['movie.mp4', 'video/mp4', '生成的视频', '影', 'video'],
  ]
  for (const [path, mime, title, icon, kind] of cases) {
    assert.deepEqual(artifactCardProfile(path, mime), {
      title, activity: title.startsWith('生成的') ? title.slice(3) : title, icon, kind,
    })
  }
  assert.deepEqual(artifactCardProfile('download', 'audio/mpeg'), {
    title: '生成的音频', activity: '音频', icon: '声', kind: 'audio',
  })
})

test('published artifact path is recovered from running and settled calls', () => {
  const argsRaw = JSON.stringify({ relative_path: 'out/report.docx' })
  assert.equal(artifactPathFromBlock({ argsRaw }), 'out/report.docx')
  assert.equal(artifactPathFromBlock({ call: { argsRaw } }), 'out/report.docx')
  assert.equal(artifactPathFromBlock({ argsRaw: '{broken' }), '')
  assert.equal(artifactPathFromBlock({ argsRaw: JSON.stringify({ relative_path: 42 }) }), '')
})
