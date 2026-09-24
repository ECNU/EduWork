import {mkdtemp,open,realpath} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'
import {getMediaFFmpegPath} from './runtime.js'
import {transcriptionInput} from './transcription.js'
import {localFile,run} from './transcription-local.js'

const bytesPerSecond=32000

function durationLimit(value) {
  if(!Number.isInteger(value)||value<1||value>14400)throw new Error('Invalid transcription duration limit')
}

function chunkLimit(value) {
  // A canonical 120-second chunk stays below SenseVoice's default 4 MiB ceiling.
  if(!Number.isInteger(value)||value<1||value>120)throw new Error('Invalid transcription chunk duration')
}

function wave(pcm) {
  const audio=Buffer.alloc(44+pcm.length)
  audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8)
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22)
  audio.writeUInt32LE(16000,24);audio.writeUInt32LE(bytesPerSecond,28)
  audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34)
  audio.write('data',36);audio.writeUInt32LE(pcm.length,40);pcm.copy(audio,44)
  return audio
}

/** Internal conversion boundary: canonical WAV only; no timestamp estimates. */
export async function transcribeDshWave({speechToText,spec,path,signal,maxDurationSeconds=3600,chunkSeconds=60}) {
  durationLimit(maxDurationSeconds);chunkLimit(chunkSeconds)
  signal.throwIfAborted()
  const file=await open(path,'r')
  try {
    const info=await file.stat()
    const header=Buffer.alloc(44)
    const {bytesRead}=await file.read(header,0,44,0)
    const dataBytes=info.size-44
    if(!info.isFile()||bytesRead!==44||dataBytes<2||dataBytes%2
      ||header.toString('ascii',0,4)!=='RIFF'||header.readUInt32LE(4)!==info.size-8
      ||header.toString('ascii',8,16)!=='WAVEfmt '||header.readUInt32LE(16)!==16
      ||header.readUInt16LE(20)!==1||header.readUInt16LE(22)!==1
      ||header.readUInt32LE(24)!==16000||header.readUInt32LE(28)!==bytesPerSecond
      ||header.readUInt16LE(32)!==2||header.readUInt16LE(34)!==16
      ||header.toString('ascii',36,40)!=='data'||header.readUInt32LE(40)!==dataBytes)throw new Error('Invalid local transcription canonical WAV audio')
    const duration=dataBytes/bytesPerSecond
    if(duration>maxDurationSeconds)throw new Error('Audio exceeds the local transcription duration limit')
    const texts=[]
    for(let offset=0;offset<dataBytes;) {
      signal.throwIfAborted()
      const pcm=Buffer.alloc(Math.min(chunkSeconds*bytesPerSecond,dataBytes-offset))
      let filled=0
      while(filled<pcm.length) {
        signal.throwIfAborted()
        const {bytesRead}=await file.read(pcm,filled,pcm.length-filled,44+offset+filled)
        if(!bytesRead)throw new Error('Local transcription WAV audio was truncated')
        filled+=bytesRead
      }
      // Preserve the provider object resolved before conversion. Re-resolving an id
      // here could move the remaining audio to a replacement provider after reload.
      const result=await speechToText.transcribe({...spec,audio:wave(pcm)},signal)
      signal.throwIfAborted()
      if(typeof result?.text!=='string'||!Number.isFinite(result.audioSeconds)||result.audioSeconds<0
        ||Math.abs(result.audioSeconds-pcm.length/bytesPerSecond)>1/16000)throw new Error('DSH transcription returned invalid audio duration or text')
      if(result.text.trim())texts.push(result.text.trim())
      offset+=pcm.length
    }
    return {text:texts.join('\n'),duration,...(spec.language!=='auto'?{language:spec.language}:{})}
  } finally {await file.close()}
}

/** Opt-in adapter for DSH 0.1.7 speechToText; preparation remains owned by the host. */
export function createDshTranscriptionProvider({speechToText,id='dsh-sensevoice',title='Local SenseVoice (DSH)',providerId='sensevoice-local',ffmpegPath,maxDurationSeconds=3600,chunkSeconds=60}={}) {
  if(!speechToText||['snapshot','resolve','transcribe'].some(key=>typeof speechToText[key]!=='function'))throw new Error('DSH speechToText service is required')
  if(typeof providerId!=='string'||!providerId.trim())throw new Error('DSH transcription provider id is required')
  durationLimit(maxDurationSeconds);chunkLimit(chunkSeconds)
  const selected=()=>speechToText.snapshot().providers.find(provider=>provider.id===providerId)
  const ready=provider=>provider?.location==='host-local'&&['ready','standby','waking'].includes(provider.preparation?.phase)
  const ffmpeg=async signal=>localFile(ffmpegPath||await getMediaFFmpegPath({signal}))
  return {id,title,local:true,timestamps:false,
    async available(){try {if(!ready(selected()))return false;await ffmpeg();return true}catch{return false}},
    async transcribe(request) {
      const signal=request.signal||new AbortController().signal
      signal.throwIfAborted()
      const provider=selected()
      if(!ready(provider))throw new Error('Local DSH transcription provider is not ready; prepare it in the host first')
      const hint=request.language||'auto'
      const language=provider.languages.includes(hint)?hint:hint.split('-')[0]
      if(!provider.languages.includes(language))throw new Error('Local DSH transcription provider does not support the requested language')
      // Pin before asynchronous conversion; never use the microphone's global selection.
      const spec=speechToText.resolve({providerId,language,audio:new Uint8Array()})
      if(spec.provider.info.location!=='host-local')throw new Error('DSH transcription adapter requires a local provider')
      const input=await transcriptionInput(request.inputPath)
      if(!request.directory||!isAbsolute(request.directory))throw new Error('Local transcription requires a caller-owned job directory')
      const root=await realpath(request.directory)
      if(process.platform==='win32'&&join(root,'transcription-XXXXXX','audio.wav').length>=260)throw new Error('本地语音转写的任务目录路径过长（Windows 原生引擎限制）。请选择较短的工作区或任务目录后重试。')
      const executable=await ffmpeg(signal)
      signal.throwIfAborted()
      const directory=await mkdtemp(join(root,'transcription-')),path=join(directory,'audio.wav')
      // Bit-exact WAV omits metadata chunks rejected by upstream. The bundled
      // FFmpeg supports WAV; its minimal build does not include the raw PCM muxer.
      await run(executable,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',input.path,
        '-t',String(maxDurationSeconds+1),'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',
        '-fflags','+bitexact','-flags:a','+bitexact','-map_metadata','-1',path],directory,'convert',signal)
      return transcribeDshWave({speechToText,spec,path,signal,maxDurationSeconds,chunkSeconds})
    },
  }
}
