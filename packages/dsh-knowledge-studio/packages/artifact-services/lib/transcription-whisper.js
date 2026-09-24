import {readFile,realpath,mkdtemp,copyFile,unlink} from 'node:fs/promises'
import {join,isAbsolute,relative} from 'node:path'
import {getMediaFFmpegPath} from './runtime.js'
import {waveDuration} from './speech.js'
import {transcriptionInput} from './transcription.js'
import {localFile,run} from './transcription-local.js'

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
