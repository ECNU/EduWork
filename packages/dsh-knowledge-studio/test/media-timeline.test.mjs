import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTimeline,subtitleText,voiceTiming,splitNarration} from '../lib/media-timeline.js'
import {MediaProviders,normalizeMediaOptions} from '../lib/media-providers.js'

test('actual audio durations determine contiguous frames and subtitle endpoints',()=>{
  const timeline=buildTimeline([{text:'第一句。',duration:1.011},{text:'第二句。',duration:2.007}],{fps:30})
  assert.equal(timeline[0].audioFrames,31)
  assert.equal(timeline[0].fromFrame,5)
  assert.equal(timeline[0].endFrame,50)
  assert.equal(timeline[1].startFrame,50)
  assert.match(subtitleText(timeline,30),/00:00:00,167 --> 00:00:01,200/)
  assert.match(subtitleText(timeline,30,'vtt'),/^WEBVTT/)
  assert.throws(()=>voiceTiming(NaN,30))
  assert.deepEqual(splitNarration('你好。第二句！'),['你好。','第二句！'])
  assert.equal(buildTimeline([{duration:3,silent:true}],{fps:30})[0].endFrame,90)
})
test('muting voice disables captions; registry exposes only public metadata',async()=>{
  assert.equal(normalizeMediaOptions({narration:'off',subtitles:'on'}).subtitles,false)
  assert.throws(()=>normalizeMediaOptions({speed:'broken'}))
  assert.throws(()=>normalizeMediaOptions({bgmVolume:'broken'}))
  assert.equal(normalizeMediaOptions({bgmVolume:0}).duckVolume,0)
  assert.equal(normalizeMediaOptions({bgmVolume:.03,duckVolume:.06}).duckVolume,.03)
  const providers=new MediaProviders(),dispose=providers.registerSpeech({id:'test',title:'Test',local:true,secret:'never serialize',voices:async()=>[{id:'one',title:'One'}],synthesize:async()=>{}})
  assert.equal(JSON.stringify(await providers.describe()).includes('secret'),false)
  assert.throws(()=>providers.registerSpeech({id:'test',voices:()=>[],synthesize:()=>{}}))
  dispose();assert.throws(()=>providers.speech('test'))
})
