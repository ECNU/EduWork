import {access,rename} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {getMediaFFmpegPath} from '@eduwork/dsh-artifact-services/runtime'

const pending=new Map(),run=promisify(execFile)
export async function videoPoster(video) {
  const path=video.path+'.poster.jpg'
  if(!pending.has(path))pending.set(path,(async()=>{
    try{await access(path)}catch{
      // Reuse the renderer's bundled FFmpeg; no shell or system installation.
      const ffmpeg=await getMediaFFmpegPath()
      const temporary=path+'.'+randomUUID()+'.jpg'
      await run(ffmpeg,['-hide_banner','-loglevel','error','-ss','0.4','-i',video.path,'-frames:v','1','-vf','scale=960:960:force_original_aspect_ratio=decrease','-q:v','3',temporary],{windowsHide:true,timeout:30000,maxBuffer:1024*1024})
      await rename(temporary,path)
    }
    return {format:'poster',path,fileName:'preview.jpg'}
  })().finally(()=>pending.delete(path)))
  return pending.get(path)
}
