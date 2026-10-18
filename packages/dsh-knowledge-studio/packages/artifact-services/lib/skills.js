import {readFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {withOfficialOfficeProvider} from './official-office.js'

export function installArtifactSkills(ctx,{images}={}) {
  const disposers=[]
  let disposed=false,revision=0,imageDisposer
  const register=(kind,metadata)=>{
    const path=fileURLToPath(new URL(`../skills/${kind}/SKILL.md`,import.meta.url)),raw=readFileSync(path,'utf8')
    const description=raw.match(/^description: (.+)$/m)?.[1] || kind
    return {name:'artifact-'+kind,description,whenToUse:description,
      invocation:{modelInvocable:true,userInvocable:true},source:'bundled',path,resourceBase:{kind:'directory',path:dirname(path)},
      ...(metadata?{metadata}:{}),content:raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim()}
  }
  const definitions=['documents','spreadsheets','presentations','pdfs','speech','video'].map(kind=>register(kind))
  if(typeof ctx.skills.registerProvider==='function') {
    disposers.push(ctx.skills.registerProvider(()=>withOfficialOfficeProvider({name:'artifact-office',
      list:async()=>{
        const {BUNDLED_SKILL_RANK}=await import('@deepseek-ai/dsh-skill')
        return definitions.map(({content,...summary})=>({...summary,provider:'artifact-office',rank:BUNDLED_SKILL_RANK,locator:summary.name}))
      },
      get:async candidate=>({...definitions.find(skill=>skill.name===candidate.name),provider:'artifact-office'}),
    })))
  } else {
    // Legacy registry-only embedders retain the original product instructions.
    for(const skill of definitions)disposers.push(ctx.skills.register(skill))
  }
  const refreshImages=async()=>{
    const current=++revision
    let available=false
    try {available=(await images?.list()||[]).some(provider=>provider.available)}catch{}
    if(disposed||current!==revision)return
    if(available&&!imageDisposer)imageDisposer=ctx.skills.register(register('images',{artifact:{capability:'image-generation'}}))
    else if(!available&&imageDisposer){imageDisposer();imageDisposer=undefined}
  }
  const detach=ctx.on('artifact-services/images-changed',refreshImages)
  if(typeof detach==='function')disposers.push(detach)
  void refreshImages()
  const dispose=()=>{disposed=true;revision++;imageDisposer?.();imageDisposer=undefined;disposers.reverse().forEach(dispose=>dispose())}
  return dispose
}
