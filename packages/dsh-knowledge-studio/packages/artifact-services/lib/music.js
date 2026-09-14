import {readFile,realpath} from 'node:fs/promises'
import {join,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'

export const defaultMusicRoot=fileURLToPath(new URL('../media/bgm/',import.meta.url))
export async function loadMusicCatalog(providers,directory=defaultMusicRoot) {
  const root=await realpath(directory)
  const catalog=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'))
  const disposers=[]
  try {
    for(const track of catalog.tracks || []) {
      const path=await realpath(join(root,track.filename)),rel=relative(root,path)
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('BGM path outside catalog')
      const extension=track.filename.split('.').at(-1)
      disposers.push(providers.registerMusic({...track,path,mime:track.mime || (extension==='mp3'?'mpeg':extension)}))
    }
  } catch(e) {disposers.reverse().forEach(d=>d());throw e}
  return ()=>disposers.reverse().forEach(d=>d())
}
