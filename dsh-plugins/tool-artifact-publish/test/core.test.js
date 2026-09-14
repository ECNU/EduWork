import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactMediaType, normalizeArtifactRelativePath, presentArtifactCall } from '../lib/core.js'

test('normalizes only project-relative artifact paths', () => {
  assert.equal(normalizeArtifactRelativePath('.ecnu-agent\\generated\\videos\\demo.mp4'), '.ecnu-agent/generated/videos/demo.mp4')
  assert.throws(() => normalizeArtifactRelativePath('C:\\outside.mp4'), /project-relative/)
  assert.throws(() => normalizeArtifactRelativePath('../outside.mp4'), /inside/)
})

test('publishes video as a produced-file edit location', () => {
  const file = '.ecnu-agent/generated/videos/demo.mp4'
  assert.equal(artifactMediaType(file), 'video/mp4')
  assert.deepEqual(presentArtifactCall({ relative_path: file }), {
    card: 'generic', title: `Publish artifact · ${file}`, kind: 'edit', locations: [{ path: file }],
  })
  assert.deepEqual(presentArtifactCall({ relative_path: 'video/../demo.mp4' }).locations, [{ path: 'demo.mp4' }])
  assert.equal(presentArtifactCall({ relative_path: '../outside.mp4' }).locations, undefined)
})

test('publishes every supported artifact family with its canonical MIME type', () => {
  const cases = {
    'report.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'book.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'slides.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'paper.pdf': 'application/pdf',
    'cover.PNG': 'image/png',
    'voice.ogg': 'audio/ogg',
    'voice.opus': 'audio/ogg',
    'voice.aac': 'audio/aac',
    'voice.flac': 'audio/flac',
    'movie.webm': 'video/webm',
  }
  for (const [file, mime] of Object.entries(cases)) assert.equal(artifactMediaType(file), mime)
})
