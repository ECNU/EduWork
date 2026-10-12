import assert from 'node:assert/strict'
import test from 'node:test'
import {BUILTIN_CAPABILITIES,mediaParameters} from '../lib/capabilities.js'
import {artifactRequest,parameterVisible} from '../lib/studio-instructions.js'

const media={speech:[{id:'system',title:'System',available:true,local:true,voices:[{id:'test-voice',title:'Test voice'}]}],music:[{id:'test-music',title:'Test music'}]}
const capability=kind=>({...BUILTIN_CAPABILITIES.find(item=>item.id===kind),parameters:[...BUILTIN_CAPABILITIES.find(item=>item.id===kind).parameters,...mediaParameters(kind,media)]})
const defaults=value=>Object.fromEntries(value.parameters.map(parameter=>[parameter.id,parameter.default]))

for(const kind of ['audio','video']) {
  test(`${kind} requests preserve music off and omit its hidden volume`,()=>{
    const value=capability(kind),parameters={...defaults(value),bgm:'',bgmVolume:.5}
    const request=artifactRequest(value,parameters)
    assert.match(request,/^背景音乐：关闭$/m)
    assert.doesNotMatch(request,/背景音乐音量|面向谁？|主题与要求|资料范围/)
    assert.equal(parameterVisible(value.parameters.find(parameter=>parameter.id==='bgmVolume'),parameters),false)
  })

  test(`${kind} requests preserve selected music and volume`,()=>{
    const value=capability(kind),parameters={...defaults(value),bgm:'test-music',bgmVolume:.3}
    const request=artifactRequest(value,parameters)
    assert.match(request,/^背景音乐：Test music$/m)
    assert.match(request,/^背景音乐音量：适中$/m)
    assert.equal(parameterVisible(value.parameters.find(parameter=>parameter.id==='bgmVolume'),parameters),true)
  })
}

test('requests omit absent choices while preserving labeled empty selections',()=>{
  const value=capability('audio')
  assert.doesNotMatch(artifactRequest(value,{}),/背景音乐|音色/)
  const request=artifactRequest(value,{...defaults(value),style:'dialogue'})
  assert.match(request,/^音色 A：自动选择$/m)
  assert.match(request,/^音色 B：与音色 A 相同$/m)
  assert.doesNotMatch(artifactRequest(value,defaults(value)),/音色 B/)
})

test('video narration conditions accept form strings and normalized booleans',()=>{
  const value=capability('video')
  for(const narration of ['off',false]) {
    const request=artifactRequest(value,{...defaults(value),narration})
    assert.match(request,/^配音：关闭$/m)
    assert.match(request,/^无配音时每场景时长：6 秒$/m)
    assert.doesNotMatch(request,/语音服务|音色 A|语速|字幕与字幕文件/)
  }
  for(const narration of ['on',true]) {
    const request=artifactRequest(value,{...defaults(value),narration})
    assert.match(request,/^配音：开启$/m)
    assert.match(request,/^语音服务：System · 本地$/m)
    assert.doesNotMatch(request,/无配音时每场景时长/)
  }
})
