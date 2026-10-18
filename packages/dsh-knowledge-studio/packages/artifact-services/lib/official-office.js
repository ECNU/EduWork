import {createRequire} from 'node:module'
import {statSync} from 'node:fs'
import {mkdir,realpath,stat} from 'node:fs/promises'
import {basename,dirname,extname,isAbsolute,join,relative,resolve} from 'node:path'
import {isSea} from 'node:sea'
import {pathToFileURL} from 'node:url'

const workflows=Object.freeze({'artifact-documents':'office-docx','artifact-spreadsheets':'office-xlsx','artifact-presentations':'office-pptx'})

// Resolve only the installed host packages. No PATH search, downloads or system
// LibreOffice fallback. Older standalone hosts can keep their existing writer.
export function officialOfficeRuntime(environment=process.env,{required=false}={}) {
  const anchor=environment.DSH_MEDIA_NODE_ENV
  if(anchor&&!isAbsolute(anchor))throw new Error('DSH_MEDIA_NODE_ENV must be absolute')
  const require=createRequire(anchor?join(anchor,'package.json'):import.meta.url)
  const find=name=>{try{return dirname(require.resolve(name+'/package.json'))}catch(error){if(error.code==='MODULE_NOT_FOUND')return null;throw error}}
  const office=find('@deepseek-ai/dsh-skill-office'),kit=find('@deepseek-ai/libreoffice-kit')
  if(!office||!kit) {
    if(office||kit)throw new Error('The installed official Office runtime is incomplete')
    if(required)throw new Error('The host must provide @deepseek-ai/dsh-skill-office and @deepseek-ai/libreoffice-kit for this Office operation')
    return null
  }
  const cli=join(kit,'lib/cli.js')
  for(const file of [cli])if(!statSync(file).isFile())throw new Error('The installed official Office runtime is incomplete')
  return {office,kit,cli,entry:require.resolve('@deepseek-ai/libreoffice-kit'),skills:require('@deepseek-ai/dsh-skill-office')}
}

/** Use the official public plugin to obtain its provider, without registering a
 * second catalogue that could bypass product preferences. The facade accepts
 * only the registry contribution; official parsing and resources stay upstream. */
export function officialOfficeProvider(environment=process.env) {
  const runtime=officialOfficeRuntime(environment)
  if(!runtime)return undefined
  const node=environment.DSH_OFFICE_NODE??process.execPath
  if(!environment.DSH_OFFICE_NODE&&(process.versions.electron||isSea()))throw new Error('Office workflows require a standalone DSH_OFFICE_NODE')
  let provider
  runtime.skills.apply({skills:{registerProvider(factory){
    if(provider)throw new Error('Unexpected extra official Office provider')
    provider=factory({invalidate(){}})
    return ()=>{}
  }}},{node,cli:runtime.cli})
  if(!provider)throw new Error('The installed Office plugin did not register a skill provider')
  return provider
}

const rewriteNames=content=>content.replace(/`office-(docx|xlsx|pptx)`/g,(_match,format)=>'`'+Object.keys(workflows).find(key=>workflows[key]==='office-'+format)+'`')
const auxiliaryAllowed=(name,enabled)=>name==='office-recalculate'
  ? enabled('artifact-spreadsheets') : Object.keys(workflows).some(enabled)

/** Preserve filesystem ranking and custom overrides; auxiliary operations are
 * model-only and share the three product switches, including after refresh. */
export function withOfficialOfficeProvider(delegate,{environment=process.env,enabled=()=>true}={}) {
  const official=officialOfficeProvider(environment)
  if(!official)return delegate
  const python=environment.DSH_OFFICE_PYTHON
    ? '\n\nWhen load_workspace_dependencies is unavailable, use Python at '+JSON.stringify(environment.DSH_OFFICE_PYTHON)+'.' : ''
  const originals=async options=>{
    const list=await official.list(options)
    return Array.isArray(list)?list:list.candidates
  }
  return {
    name:delegate.name,
    async list(options){
      const observation=await delegate.list(options)
      const candidates=Array.isArray(observation)?observation:observation.candidates
      const available=name=>enabled(name)&&candidates.some(candidate=>candidate.name===name)
      const extra=(await originals(options)).filter(candidate=>!Object.values(workflows).includes(candidate.name)
        &&enabled(candidate.name)&&auxiliaryAllowed(candidate.name,available)).map(candidate=>({...candidate,
          provider:delegate.name,invocation:{modelInvocable:true,userInvocable:false},
          locator:{officialOffice:candidate}}))
      const combined=[...candidates,...extra]
      return Array.isArray(observation)?combined:{...observation,candidates:combined}
    },
    async get(candidate,options){
      if(candidate.locator?.officialOffice){
        const original=candidate.locator.officialOffice
        if(!enabled(original.name)||!auxiliaryAllowed(original.name,enabled))return undefined
        const skill=await official.get(original,options)
        return {...skill,provider:delegate.name,invocation:{modelInvocable:true,userInvocable:false},content:rewriteNames(skill.content)+python}
      }
      const skill=await delegate.get(candidate,options)
      if(!skill||candidate.source!=='bundled'||!workflows[skill.name])return skill
      if(!enabled(skill.name))return undefined
      const original=(await originals(options)).find(item=>item.name===workflows[skill.name])
      if(!original)throw new Error('The installed Office plugin is missing '+workflows[skill.name])
      const loaded=await official.get(original,options)
      const integration=skill.content.replace(/\]\((\.\.?\/[^)]+)\)/g,(_,path)=>'](<'+resolve(skill.resourceBase.path,path).replaceAll('\\','/')+'>)')
      return {...skill,resourceBase:loaded.resourceBase,content:rewriteNames(loaded.content)+python+'\n\n## EduWork integration\n\n'+integration}
    },
  }
}

/** Standalone hosts load through the same provider contract as the product. */
export async function withOfficialOfficeSkill(skill,environment=process.env) {
  if(!workflows[skill?.name])return skill
  const delegate={name:'artifact-office',list:async()=>[skill],get:async()=>skill}
  return withOfficialOfficeProvider(delegate,{environment}).get({...skill,source:'bundled'}, {})
}

export function withinOfficeRoot(root,path) {
  const value=relative(root,path)
  if(isAbsolute(value)||value==='..'||value.startsWith('../')||value.startsWith('..\\'))throw new Error('Office path is outside the current workspace')
  return path
}

export async function officeInputPath(projectPath,input) {
  const root=await realpath(projectPath)
  const path=withinOfficeRoot(root,await realpath(join(root,input)))
  if(!(await stat(path)).isFile())throw new Error('Office input must be a regular file')
  return path
}

export async function officeOutputPath(projectPath,output) {
  const root=await realpath(projectPath),target=withinOfficeRoot(root,resolve(root,output))
  let parent=root
  for(const segment of relative(root,dirname(target)).split(/[\\/]/).filter(Boolean)) {
    const child=join(parent,segment)
    try{await mkdir(child)}catch(error){if(error.code!=='EEXIST')throw error}
    parent=withinOfficeRoot(root,await realpath(child))
  }
  return join(parent,basename(target))
}

/** Absolute, already-authorized paths; the Kit owns format checking and exclusive output. */
export async function convertOfficeFile({inputPath,outputPath,signal,environment=process.env,recalculate=false}) {
  signal?.throwIfAborted()
  if(!isAbsolute(inputPath)||!isAbsolute(outputPath))throw new Error('Office conversion requires absolute paths')
  const runtime=officialOfficeRuntime(environment,{required:true})
  const {createConverter}=await import(pathToFileURL(runtime.entry).href)
  const converter=await createConverter({timeoutMs:120_000})
  try {
    const options={inputPath,outputPath}
    const result=await (recalculate?converter.recalculate(options,signal):converter.convert(options,signal))
    return {provider:'dsh-libreoffice-kit',backend:result.backend,sourceFormat:extname(inputPath).slice(1),format:extname(outputPath).slice(1),missingFonts:result.missingFonts??[]}
  } finally {await converter.dispose()}
}
