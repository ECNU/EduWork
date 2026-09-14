import {spawn} from 'node:child_process'
import {open,readFile,realpath,stat,mkdtemp,writeFile,copyFile,unlink} from 'node:fs/promises'
import {join,isAbsolute,relative} from 'node:path'
import {getMediaFFmpegPath} from './runtime.js'
import {waveDuration} from './speech.js'
import {transcriptionInput} from './transcription.js'

async function localFile(path) {
  if(!path||!isAbsolute(path))throw new Error('Configure an absolute local transcription runtime/model path')
  const resolved=await realpath(path)
  if(!(await stat(resolved)).isFile())throw new Error('Local transcription component is unavailable')
  return resolved
}

async function run(executable,args,directory,stage,signal) {
  signal?.throwIfAborted()
  const out=await open(join(directory,stage+'.stdout.log'),'wx'),err=await open(join(directory,stage+'.stderr.log'),'wx')
  try {
    const startedAt=new Date().toISOString()
    let pid,exitCode,startReceipt
    try {await new Promise((resolve,reject)=>{
      const child=spawn(executable,args,{cwd:directory,windowsHide:true,shell:false,signal,stdio:['ignore',out.fd,err.fd]})
      pid=child.pid
      startReceipt=writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,status:'running'}))
      // Retain the logging error until the child closes; do not detach inference.
      startReceipt.catch(()=>{})
      // Wait for close (including on cancellation), so no child retains output handles.
      let failed
      child.once('error',error=>{failed=error})
      child.once('close',code=>{
        exitCode=code
        if(signal?.aborted)reject(signal.reason)
        else if(failed||code!==0)reject(new Error(`Local transcription ${stage} failed; inspect the job logs`))
        else resolve()
      })
    })} finally {await startReceipt;await writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,finishedAt:new Date().toISOString(),exitCode,cancelled:Boolean(signal?.aborted)}))}
  } finally {await out.close();await err.close()}
}

/** Optional CPU CLI adapter; registration/invocation never installs or downloads. */
export function createWhisperCppTranscriptionProvider({id='whisper-cpp',title='Local Whisper (CPU)',executablePath,modelPath,model='whisper-tiny-q5_1',threads=4,ffmpegPath,maxDurationSeconds=3600}={}) {
  if(!Number.isInteger(threads)||threads<1||threads>64)throw new Error('Invalid transcription thread count')
  if(!Number.isInteger(maxDurationSeconds)||maxDurationSeconds<1||maxDurationSeconds>14400)throw new Error('Invalid transcription duration limit')
  const paths=async()=>Promise.all([localFile(executablePath),localFile(modelPath)])
  return {id,title,model,local:true,timestamps:true,
    async available(){try {await paths();await localFile(ffmpegPath||await getMediaFFmpegPath());return true}catch{return false}},
    async transcribe(request) {
      request.signal?.throwIfAborted()
      const [executable,weights]=await paths(),input=await transcriptionInput(request.inputPath)
      if(!request.directory||!isAbsolute(request.directory))throw new Error('Local transcription requires a caller-owned job directory')
      const root=await realpath(request.directory)
      // Include the six-character mkdtemp suffix and the longest native output
      // basename. Fail before conversion/inference (or mkdtemp's generic error).
      if(process.platform==='win32'&&join(root,'transcription-XXXXXX','result.json').length>=260)throw new Error('本地语音转写的任务目录路径过长（Windows 原生引擎限制）。请选择较短的工作区或任务目录后重试。')
      const directory=await mkdtemp(join(root,'transcription-'))
      const ffmpeg=ffmpegPath?await localFile(ffmpegPath):await getMediaFFmpegPath({signal:request.signal})
      const audio=join(directory,'input.wav'),output=join(directory,'result')
      await run(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',input.path,'-t',String(maxDurationSeconds+1),'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',audio],directory,'convert',request.signal)
      const duration=waveDuration(await readFile(audio))
      if(duration>maxDurationSeconds)throw new Error('Audio exceeds the local transcription duration limit')
      // The Windows CLI rejects Unicode argv paths and can exceed MAX_PATH when
      // combining a deep cwd with even an ASCII relative model path. Always stage
      // a private copy under a short basename; never hard-link the host's model.
      let modelArgument=relative(directory,weights),stagedModel
      try {
        if(process.platform==='win32') {
          stagedModel=join(directory,'model.bin');await copyFile(weights,stagedModel);modelArgument='model.bin'
        }
        await run(executable,['-m',modelArgument,'-f','input.wav','-l',request.language?.split('-')[0]||'auto','-t',String(threads),'-ng','-oj','-of','result'],directory,'recognize',request.signal)
      } finally {if(stagedModel)await unlink(stagedModel).catch(error=>{if(error.code!=='ENOENT')throw error})}
      request.signal?.throwIfAborted()
      const result=JSON.parse(await readFile(output+'.json','utf8'))
      if(!Array.isArray(result.transcription))throw new Error('Local transcription returned invalid JSON')
      const segments=result.transcription.map(segment=>({start:Math.min(duration,Math.max(0,segment.offsets?.from/1000)),end:Math.min(duration,Math.max(0,segment.offsets?.to/1000)),text:segment.text}))
      return {text:segments.map(segment=>segment.text).join('').trim(),segments,language:result.result?.language,duration,model}
    }}
}
