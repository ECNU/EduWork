import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createMediaProviders} from '../packages/artifact-services/lib/providers.js'
import {inspectMediaRuntime,getMediaFFmpegPath} from '../packages/artifact-services/lib/runtime.js'
import {renderMedia} from '../packages/artifact-services/lib/media.js'
import {loadMusicCatalog} from '../packages/artifact-services/lib/music.js'
import {waveDuration} from '../packages/artifact-services/lib/speech.js'

// Real local files; no LLM, remote speech provider or component download.
const base=resolve(process.env.STUDIO_MEDIA_OUTPUT||'dist/stage-local-media')
await mkdir(base,{recursive:true})
const output=await mkdtemp(join(base,'run-'))
await writeFile(join(output,'process.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}))
assert.equal((await inspectMediaRuntime()).available,true,'Provision the pinned local media runtime first')
const providers=createMediaProviders()
await loadMusicCatalog(providers)
const catalog=await providers.describe()
assert.ok(catalog.speech.some(provider=>provider.id==='system'&&provider.voices.some(voice=>voice.language==='zh-CN')),'A Chinese system voice is required by this test')
const ffmpeg=await getMediaFFmpegPath(),results=[]
for(const mode of ['audio','narrated-video','silent-video']) {
  const kind=mode==='audio'?'audio':'video',directory=join(output,mode)
  const options={provider:'system',narration:mode!=='silent-video',subtitles:true,sceneSeconds:3,
    ...(mode!=='silent-video'&&catalog.music[0]?{bgm:catalog.music[0].id}:{})}
  const request={id:mode,kind,title:'本机媒体验收',options,segments:kind==='audio'?
    [{speaker:'A',text:'这是本机音频文件。'}]:[{heading:'本机视频',bullets:['真实文件输出'],narration:'这是本机视频。'}]}
  const file=await renderMedia(request,directory,undefined,message=>console.log(mode,message),providers)
  assert.ok((await stat(file.path)).size>100)
  execFileSync(ffmpeg,['-hide_banner','-i',file.path,'-c:v','libx264','-preset','ultrafast','-c:a','pcm_s16le','-f','null','-'],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']})
  if(kind==='audio')assert.ok(waveDuration(await readFile(file.path))>0)
  const timeline=JSON.parse(await readFile(join(directory,'timeline.json'),'utf8'))
  assert.equal(timeline.options.narration,mode!=='silent-video')
  if(mode==='silent-video') {
    assert.equal(file.attachments.length,0)
    assert.ok(timeline.scenes.every(scene=>scene.silent&&scene.text===''))
  } else {
    const subtitles=await readFile(file.attachments.find(item=>item.format==='srt').path,'utf8')
    assert.match(subtitles,/这是本机/)
    assert.ok(timeline.scenes.every(scene=>scene.duration>0&&scene.jobHash))
  }
  results.push({mode,...file,decoded:true})
}
await writeFile(join(output,'result.json'),JSON.stringify({passed:true,results,externalModelCalls:0,remoteSpeechCalls:0},null,2))
console.log(JSON.stringify({passed:true,output}))
