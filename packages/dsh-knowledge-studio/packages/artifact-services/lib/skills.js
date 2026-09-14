import {readFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

export function installArtifactSkills(ctx,{images}={}) {
  const disposers=[]
  const register=(kind,metadata)=>{
    const path=fileURLToPath(new URL(`../skills/${kind}/SKILL.md`,import.meta.url)),raw=readFileSync(path,'utf8')
    const description=raw.match(/^description: (.+)$/m)?.[1] || kind
    return ctx.skills.register({name:'artifact-'+kind,description,whenToUse:description,
      invocation:{modelInvocable:true,userInvocable:true},source:'bundled',path,resourceBase:{kind:'directory',path:dirname(path)},
      ...(metadata?{metadata}:{}),content:raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim()})
  }
  for(const kind of ['documents','spreadsheets','presentations','pdfs','speech','video'])disposers.push(register(kind))
  let disposed=false,revision=0,imageDisposer
  const refreshImages=async()=>{
    const current=++revision
    let available=false
    try {available=(await images?.list()||[]).some(provider=>provider.available)}catch{}
    if(disposed||current!==revision)return
    if(available&&!imageDisposer)imageDisposer=register('images',{artifact:{capability:'image-generation'}})
    else if(!available&&imageDisposer){imageDisposer();imageDisposer=undefined}
  }
  const detach=ctx.on('artifact-services/images-changed',refreshImages)
  if(typeof detach==='function')disposers.push(detach)
  void refreshImages()
  return ()=>{disposed=true;revision++;imageDisposer?.();imageDisposer=undefined;disposers.reverse().forEach(dispose=>dispose())}
}
