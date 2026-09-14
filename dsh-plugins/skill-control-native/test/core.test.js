import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateEnabled, effectiveDisabled, filterObservation, normalizeDisabled, requiredCapability, requiredCredential, requiredAccountBinding, accountBindingKey } from '../lib/core.js'

const publicSkill = { name: 'artifact-documents', metadata: undefined }
const ecnuSkill = { name: 'ecnu-campus-search', metadata: { chatecnu: { credentialRef: 'CHATECNU_API_KEY' } } }

test('a shared key cannot expose a skill bound to another institution', () => {
  const skill = { name: 'campus-search', metadata: { eduwork: { credentialRef: 'EDUWORK_API_KEY', oidcProfileId: 'campus-a', runtimeBaseURL: 'https://a.example/v1' } } }
  const configured = new Set(['EDUWORK_API_KEY'])
  const ready = new Set([accountBindingKey(requiredAccountBinding(skill))])
  assert.equal(candidateEnabled(skill, new Set(), configured), false)
  assert.equal(candidateEnabled(skill, new Set(), configured, new Set(), ready), true)
  const other = structuredClone(skill)
  other.metadata.eduwork.runtimeBaseURL = 'https://b.example/v1'
  assert.equal(candidateEnabled(other, new Set(), configured, new Set(), ready), false)
  assert.equal(candidateEnabled(publicSkill, new Set(), configured), true)
})

test('normalizes persisted disabled names without accepting paths or duplicates', () => {
  assert.deepEqual(normalizeDisabled(['ecnu-tts', '../escape', 'ecnu-tts', 'documents']), ['artifact-documents', 'artifact-speech'])
})

test('reads only a valid declared credential reference', () => {
  assert.equal(requiredCredential(ecnuSkill), 'CHATECNU_API_KEY')
  assert.equal(requiredCredential({ metadata: { chatecnu: { credentialRef: '../secret' } } }), undefined)
})

test('disabled and unconfigured enterprise skills disappear', () => {
  assert.equal(candidateEnabled(publicSkill, new Set(), new Set()), true)
  assert.equal(candidateEnabled(publicSkill, effectiveDisabled({ disabled: ['documents'] }), new Set()), false)
  assert.equal(candidateEnabled(ecnuSkill, new Set(), new Set()), false)
  assert.equal(candidateEnabled(ecnuSkill, new Set(), new Set(['CHATECNU_API_KEY'])), true)
})

test('preserves provider completeness while filtering observations', () => {
  const result = filterObservation({ candidates: [publicSkill, ecnuSkill], complete: false }, new Set(), new Set())
  assert.equal(result.complete, false)
  assert.deepEqual(result.candidates, [publicSkill])
})

test('default-off skills require an explicit enabled override', () => {
  assert.deepEqual([...effectiveDisabled({ defaultDisabled: ['ui-ux-pro-max'] })], ['ui-ux-pro-max'])
  assert.deepEqual([...effectiveDisabled({ defaultDisabled: ['ui-ux-pro-max'], enabled: ['ui-ux-pro-max'] })], [])
  assert.deepEqual([...effectiveDisabled({ disabled: ['documents'], enabled: ['documents'] })], ['artifact-documents'])
})

test('generic image visibility follows a ready provider, independently of ECNU credentials', () => {
  const image = { name: 'artifact-images', metadata: { artifact: { capability: 'image-generation' } } }
  assert.equal(requiredCapability(image), 'image-generation')
  assert.equal(candidateEnabled(image, new Set(), new Set(['CHATECNU_API_KEY'])), false)
  assert.equal(candidateEnabled(image, new Set(), new Set(), new Set(['image-generation'])), true)
  assert.equal(candidateEnabled(image, effectiveDisabled({ disabled: ['ecnu-imagegen'] }), new Set(), new Set(['image-generation'])), false)
  const studio = { name: 'knowledge-studio' }
  assert.equal(candidateEnabled(studio, effectiveDisabled({ disabled: ['knowledge-studio'] }), new Set()), false)
})

test('current and legacy skill names share one discovery entry without losing unrelated skills', () => {
  const legacy={name:'documents',source:'user-dsh',rank:400}
  const notes={name:'private-notes',source:'user-dsh',rank:400}
  for(const candidates of [[legacy,publicSkill,notes],[notes,publicSkill,legacy]]) {
    const result=filterObservation({candidates,complete:false},new Set(),new Set())
    assert.equal(result.complete,false)
    assert.deepEqual(result.candidates.map(row=>row.name).sort(),['artifact-documents','private-notes'])
    assert.equal(result.candidates.find(row=>row.name==='artifact-documents'),publicSkill)
  }
  assert.deepEqual(filterObservation([legacy],new Set(),new Set()),[legacy],'legacy-only assemblies still work')
  assert.deepEqual(filterObservation([legacy,publicSkill],effectiveDisabled({disabled:['documents']}),new Set()),[])
})

test('an unavailable shared provider cannot expose a legacy execution route', () => {
  const legacy={name:'ecnu-imagegen'}
  const image={name:'artifact-images',metadata:{artifact:{capability:'image-generation'}}}
  assert.deepEqual(filterObservation([legacy,image],new Set(),new Set()),[])
  assert.deepEqual(filterObservation([legacy,image],new Set(),new Set(),new Set(['image-generation'])),[image])
})
