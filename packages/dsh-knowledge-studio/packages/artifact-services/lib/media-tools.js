import {defineTool} from '@deepseek-ai/dsh-tools'
import {realpath} from 'node:fs/promises'
import {relative} from 'node:path'
import {createMediaJobDirectory as jobDirectory,assertWithinWorkspace} from './media-paths.js'
import {renderMedia} from './media.js'
import {runVideoCommand} from './video-runner.js'
import {createMediaRuntime} from './runtime.js'
import {structuredSpec} from './structured-spec.js'

async function workspace(ctx,exec) {
  const cwd=exec.agent?.session.header.cwd
  if(typeof cwd!=='string'||!cwd)throw new Error('Media tools require an Agent workspace')
  const locator=await ctx.fs.resolve('.',{cwd,signal:exec.signal})
  return realpath(ctx.fs.processPath(locator))
}
export function installMediaTools(ctx,service) {
  const requireMediaRuntime=async()=>{
    const readiness=await service.mediaReadiness()
    if(!readiness.available)throw new Error(readiness.reason)
  }
  const writes=new Set(['speech_synthesize','media_render','video_project'])
  ctx.on('tools/pre-execute',(exec,next)=>{
    if(!writes.has(exec.name))return next()
    if(exec.name==='video_project'&&['validate','voiceover-jobs'].includes(exec.arguments?.action))return next()
    if(!exec.agent)return Promise.resolve({kind:'deny',reason:'Media writes require an Agent session'})
    if(ctx.permissionPresets.current(exec.agent.session)==='danger-full-access')return next()
    const reason=exec.name==='video_project'?'Create or modify an editable video project in the current workspace':exec.name==='speech_synthesize'?'Generate speech in the current workspace using the selected provider':'Render audio or video in the current workspace with the selected media settings'
    return Promise.resolve({kind:'ask',reason})
  })
  const schema={type:'object',additionalProperties:false,properties:{reportJSON:{type:'string',required:true},relativePath:{type:'string'},mime:{type:'string'}}}
  const output={schema,render:(_,v)=>[{type:'text',text:v.reportJSON}],presentationMeta:(_,v)=>v.relativePath?{relativePath:v.relativePath,mime:v.mime}:{}}
  ctx.tools.register(defineTool({name:'speech_voices',description:'List available speech providers and voices; use these identifiers for all speech and video tools.',parameters:{},output,
    async execute(){await service.ready;return {reportJSON:JSON.stringify({...await service.media.describe(),runtime:await service.mediaReadiness()})}}}))
  ctx.tools.register(defineTool({name:'speech_synthesize',description:'Synthesize exact text with a local or extension speech provider. Discover voices with speech_voices. Output WAV; no silent provider fallback.',
    parameters:{text:{type:'string',required:true},provider:{type:'string',required:true},voice:{type:'string'},speed:{type:'number'}},output,timeoutMs:600000,
    async execute(args,exec){
      await service.ready
      const root=await workspace(ctx,exec),directory=await jobDirectory(root)
      const result=await service.speech.synthesize({...args,format:'wav',directory,name:'speech',signal:exec.signal,execution:exec,sessionId:exec.agent.session.id})
      const path=await realpath(result.path),rel=assertWithinWorkspace(root,path)
      return {reportJSON:JSON.stringify({...result,relativePath:rel.replaceAll('\\','/')}),relativePath:rel.replaceAll('\\','/'),mime:'audio/wav'}
    }}))
  ctx.tools.register(defineTool({name:'media_render',description:'Render audio/video workspace files with shared speech, subtitles and BGM; this does not register Studio artifacts. If the user requests a Studio artifact, use knowledge_studio_create_artifact instead. spec: {kind:audio|video,title,segments:[{heading,bullets,narration,text,speaker}],options:{provider,voice,voiceB,narration,subtitles,bgm,aspect,speed}}. Audio segments require text; video segments use narration and bullets. Discover providers/music with speech_voices.',
    parameters:{spec:{type:'object',additionalProperties:true,description:'Preferred direct media object, without JSON string escaping.'},spec_json:{type:'string',description:'Legacy JSON string alternative; provide only one of spec and spec_json.'}},output,timeoutMs:1200000,
    async execute(args,exec){
      await service.ready
      const spec=structuredSpec(args)
      if(!['audio','video'].includes(spec.kind)||!Array.isArray(spec.segments)||!spec.segments.length||spec.segments.length>100)throw new Error('Invalid media specification')
      await requireMediaRuntime()
      const root=await workspace(ctx,exec),directory=await jobDirectory(root)
      const result=await renderMedia({...spec,id:'media'},directory,exec.signal,()=>{},service.media,{execution:exec,sessionId:exec.agent.session.id})
      const relativePath=relative(root,result.path).replaceAll('\\','/')
      return {reportJSON:JSON.stringify({...result,relativePath}),relativePath,mime:spec.kind==='audio'?'audio/wav':'video/mp4'}
    }}))
  ctx.tools.register(defineTool({name:'video_project',description:'Create, inspect and render editable React/Remotion projects. Keeps source-editing, audio integrity bindings, covers and review frames. Use speech_synthesize for each voiceover job, then stage-voiceover with its exact job hash.',
    parameters:{action:{type:'string',required:true,enum:['init','stage','voiceover-jobs','stage-voiceover','stage-bgm','validate','render']},
      name:{type:'string'},workspace:{type:'string'},input:{type:'string'},'scene-id':{type:'string'},'job-hash':{type:'string'},'track-id':{type:'string'},destination:{type:'string'}},output,timeoutMs:1200000,
    async execute(args,exec){
      await requireMediaRuntime()
      const root=await workspace(ctx,exec),runtime=await createMediaRuntime({signal:exec.signal})
      const {action,...options}=args
      const report=await runVideoCommand(action,{...options,'project-root':root},runtime)
      const file=report?.outputs?.video
      return {reportJSON:JSON.stringify(report),...(file?{relativePath:relative(root,file).replaceAll('\\','/'),mime:'video/mp4'}:{})}
    }}))
}
