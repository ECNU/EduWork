import test from 'node:test'
import assert from 'node:assert/strict'
import { brandDesktopLocale } from '../src/desktop-locale.mjs'

test('desktop locale replaces the upstream brand without mutating the source', () => {
  const source = { id: 'en', messages: {
    about: 'About DeepSeek Harness', quit: 'Quit DeepSeek Harness', unchanged: 'Plain text',
  } }
  const branded = brandDesktopLocale(source, 'EduWork')
  assert.deepEqual(branded, { id: 'en', messages: {
    about: 'About EduWork', quit: 'Quit EduWork', unchanged: 'Plain text',
  } })
  assert.deepEqual(source.messages, {
    about: 'About DeepSeek Harness', quit: 'Quit DeepSeek Harness', unchanged: 'Plain text',
  })
})
