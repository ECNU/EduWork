import {createRequire} from 'node:module'
import {readFileSync,statSync} from 'node:fs'
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
  const checker=join(office,'assets/scripts/check_office.py'),cli=join(kit,'lib/cli.js')
  for(const file of [checker,cli])if(!statSync(file).isFile())throw new Error('The installed official Office runtime is incomplete')
  return {office,kit,checker,cli,entry:require.resolve('@deepseek-ai/libreoffice-kit')}
}

/** Keep product skill IDs/preferences, but load the host's original workflow. */
export function withOfficialOfficeSkill(skill,environment=process.env) {
  const name=workflows[skill?.name]
  if(!name)return skill
  const runtime=officialOfficeRuntime(environment)
  if(!runtime)return skill
  // The Host is a separate Node process. A direct Electron/SEA embed must
  // explicitly configure a standalone Node rather than launch Electron as CLI.
  const node=environment.DSH_OFFICE_NODE??process.execPath
  if(!environment.DSH_OFFICE_NODE&&(process.versions.electron||isSea()))throw new Error('Office workflows require a standalone DSH_OFFICE_NODE')
  if(!isAbsolute(node)||!statSync(node).isFile())throw new Error('Office Node runtime must be an absolute executable file')
  const directory=join(runtime.office,'assets',name)
  const raw=readFileSync(join(directory,'SKILL.md'),'utf8')
  const body=raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim()
  if(body===raw.trim())throw new Error('Official Office skill has invalid frontmatter')
  const paths={libreofficeKit:{node,cli:runtime.cli},...(environment.DSH_OFFICE_PYTHON?{python:environment.DSH_OFFICE_PYTHON}:{})}
  const integration=skill.content.replace(/\]\((\.\.?\/[^)]+)\)/g,(_,path)=>`](<${resolve(skill.resourceBase.path,path).replaceAll('\\','/')}>)`)
  return {...skill,resourceBase:{kind:'directory',path:directory},content:
    `${body}\n\n## Installed LibreOffice Kit\n\n${JSON.stringify(paths,null,2)}\n\nWhen load_workspace_dependencies is unavailable, use the configured Python path above.\n\n## EduWork integration\n\n${integration}`}
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
