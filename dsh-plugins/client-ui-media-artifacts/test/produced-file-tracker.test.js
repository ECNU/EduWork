import assert from 'node:assert/strict'
import test from 'node:test'
import { successfulArtifactPaths, trackedArtifactCall } from '../src/client/produced-file-tracker.js'

test('tracks successful built-in file mutations from validated call arguments', () => {
  assert.deepEqual(trackedArtifactCall('write', JSON.stringify({ file_path: 'notes.md', content: 'ok' })), {
    name: 'write', paths: ['notes.md'],
  })
  assert.deepEqual(trackedArtifactCall('edit', JSON.stringify({
    file_path: 'notes.md', old_string: 'old', new_string: 'new',
  })).paths, ['notes.md'])
  assert.deepEqual(trackedArtifactCall('edit', JSON.stringify({
    file_path: 'notes.md', old_string: 'same', new_string: 'same',
  })).paths, [])
})

test('tracks product artifact tools without relying on a nonexistent ConversationMatch view', () => {
  assert.deepEqual(trackedArtifactCall('artifact_publish', JSON.stringify({
    relative_path: 'out/report.docx',
  })).paths, ['out/report.docx'])
  assert.deepEqual(trackedArtifactCall('office_document', JSON.stringify({
    action: 'create', output_path: 'out/report.docx',
  })).paths, ['out/report.docx'])
  assert.deepEqual(trackedArtifactCall('office_pdf', JSON.stringify({
    action: 'merge', output_path: 'out/merged.pdf',
  })).paths, ['out/merged.pdf'])
  assert.deepEqual(trackedArtifactCall('office_document', JSON.stringify({
    action: 'inspect', input_path: 'out/report.docx',
  })).paths, [])
})

test('successful result metadata supplies generated media and deduplicates call paths', () => {
  const image = trackedArtifactCall('ecnu_image_generate', JSON.stringify({ prompt: 'campus' }))
  assert.deepEqual(successfulArtifactPaths(image, { relativePath: '.ecnu-agent/generated/images/campus.png' }), [
    '.ecnu-agent/generated/images/campus.png',
  ])
  const document = trackedArtifactCall('office_document', JSON.stringify({
    action: 'create', output_path: 'out/report.docx',
  }))
  assert.deepEqual(successfulArtifactPaths(document, { relativePath: 'out/report.docx' }), ['out/report.docx'])
  assert.deepEqual(successfulArtifactPaths({ name: 'read', paths: [] }, { relativePath: 'input.txt' }), [])
  assert.deepEqual(successfulArtifactPaths(undefined, { relativePath: 'unowned.txt' }), [])
})

test('malformed or incomplete tool arguments never create fake deliverables', () => {
  assert.deepEqual(trackedArtifactCall('artifact_publish', '{broken').paths, [])
  assert.deepEqual(trackedArtifactCall('artifact_publish', JSON.stringify({ relative_path: 42 })).paths, [])
  assert.deepEqual(successfulArtifactPaths({ name: 'artifact_publish', paths: [] }, { relativePath: '' }), [])
})

test('shared image, speech and video tools expose their successful returned artifact paths', () => {
  for (const [name,relativePath] of [['image_generate','.ecnu-agent/generated/images/landscape.png'],['speech_synthesize','.artifacts/media/run/speech.wav'],['media_render','.artifacts/media/run/video.mp4'],['video_project','.artifacts/video.mp4']]) {
    const call=trackedArtifactCall(name,'{}')
    assert.deepEqual(successfulArtifactPaths(call,{relativePath}),[relativePath])
    assert.deepEqual(successfulArtifactPaths(call,{}),[])
  }
})
