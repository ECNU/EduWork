import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalSkillName, effectiveDisabledSkills, skillToggleSettings} from '../lib/policy.js'

test('retired preferences preserve disable/default-off intent without rewriting the source', () => {
  const settings = {disabled:['ecnu-imagegen','documents'],defaultDisabled:['ecnu-tts'],enabled:['artifact-speech']}
  assert.deepEqual([...effectiveDisabledSkills(settings)], ['artifact-documents','artifact-images'])
  assert.deepEqual(settings.disabled, ['ecnu-imagegen','documents'])
  assert.equal(canonicalSkillName('constructor'),'constructor')
})

test('re-enabling a renamed skill removes its legacy disabled value and preserves unrelated settings', () => {
  const next = skillToggleSettings({disabled:['ecnu-imagegen','private-notes'],enabled:[]}, 'artifact-images', true)
  assert.deepEqual(next,{disabled:['private-notes'],enabled:['artifact-images']})
  assert.equal(effectiveDisabledSkills(next).has('artifact-images'),false)
  assert.deepEqual(skillToggleSettings(next,'artifact-images',false),{disabled:['artifact-images','private-notes'],enabled:[]})
})
