import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createMediaProviders,normalizeMediaOptions} from './providers.js'
import {waveDuration} from './speech.js'
import {buildTimeline,splitNarration,subtitleText} from './timeline.js'
import {prepareComposition,renderComposition} from './remotion.js'
import {createMediaRuntime} from './runtime.js'
const here=dirname(fileURLToPath(import.meta.url))
export async function renderMedia(request,directory,signal,onProgress=()=>{},providers=createMediaProviders(),context={}) {
  await mkdir(directory,{recursive:true})
  const options=normalizeMediaOptions(request.options), fps=30
  if (request.kind==='audio') {
    // Audio shares the video timeline and renderer, so all providers support
    // multi-speaker output, actual segment timing and the same BGM ducking.
    options.narration=true
  }
  const source=request.kind==='audio'?request.segments.map(s=>({...s,heading:request.title,bullets:[],narration:s.text})):request.segments
  const segments=source.flatMap(scene=>options.narration?splitNarration(scene.narration || scene.bullets.join('。')).map(text=>({...scene,text})):[{...scene,text:''}])
  if(!segments.length)throw new Error('缺少可生成的媒体内容')
  const measured=[]
  for(const [index,segment] of segments.entries()) {
    signal?.throwIfAborted()
    if(!options.narration){measured.push({...segment,duration:options.sceneSeconds,silent:true});continue}
    onProgress(`配音 ${index+1}/${segments.length}`)
    const voice=segment.speaker==='B'?options.voiceB || options.voice:options.voice
    const jobHash=createHash('sha256').update(JSON.stringify({provider:options.provider,voice,speed:options.speed,text:segment.text})).digest('hex')
    const result=await providers.speech(options.provider).synthesize({...context,text:segment.text,voice,speed:options.speed,directory,name:`speech-${index}-${jobHash.slice(0,12)}`,signal})
    // Independently inspect actual bytes. Provider estimates never set timings.
    const bytes=await readFile(result.path)
    const duration=waveDuration(bytes)
    if(duration>30)throw new Error('单段配音超过 30 秒，请拆短旁白或调整语速')
    measured.push({...segment,duration,audio:`data:audio/wav;base64,${bytes.toString('base64')}`,jobHash})
  }
  const scenes=buildTimeline(measured,{fps,leadInSeconds:options.narration ? .18 : 0,tailSeconds:options.narration ? .45 : 0}).map(s=>({...s,frames:s.durationInFrames}))
  if(scenes.at(-1).endFrame/fps>600)throw new Error('媒体超过 10 分钟，请缩短内容后重试')
  let bgm
  if(options.bgm){const track=providers.music(options.bgm),bytes=await readFile(track.path);if(createHash('sha256').update(bytes).digest('hex')!==track.sha256)throw new Error('背景音乐文件校验失败');bgm={audio:`data:audio/${track.mime || 'wav'};base64,${bytes.toString('base64')}`,volume:options.bgmVolume,duckVolume:options.duckVolume}}
  const attachments=[]
  if(options.narration && options.subtitles)for(const format of ['srt','vtt']){const path=join(directory,`${request.id}.${format}`);await writeFile(path,subtitleText(scenes,fps,format));attachments.push({format,path,fileName:`${request.id}.${format}`})}
  await writeFile(join(directory,'timeline.json'),JSON.stringify({fps,options,scenes:scenes.map(({audio,...s})=>s)},null,2))
  onProgress('准备视频渲染')
  const inputProps={scenes,fps,aspect:options.aspect,subtitles:options.subtitles,bgm}
  const runtime=context.runtime || await createMediaRuntime({signal})
  const prepared=await prepareComposition({entryPoint:join(here,'video-template.js'),outDir:join(directory,'bundle'),id:'StudioVideo',inputProps,runtime})
  const format=request.kind==='audio'?'wav':'mp4',output=join(directory,request.id+'.'+format)
  let previous=-1
  await renderComposition(prepared,{output,format,signal,onProgress:(_,progress)=>{
    const percent=Math.floor(progress/10)*10
    if(percent!==previous){previous=percent;onProgress('渲染 '+percent+'%');void appendFile(join(directory,'render.log'),new Date().toISOString()+' render '+percent+'%\n')}
  }})
  return {format,path:output,fileName:request.id+'.'+format,attachments,duration:scenes.at(-1).endFrame/fps}
}
export {waveDuration}
