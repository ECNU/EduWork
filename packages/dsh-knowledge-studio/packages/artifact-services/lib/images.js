import {open,realpath,stat} from 'node:fs/promises'
import {isAbsolute,resolve} from 'node:path'
import {assertWithinWorkspace} from './media-paths.js'

function capabilitiesOf(provider) {
  const source=provider.capabilities||{},capabilities={}
  for(const key of ['nativeSizes','fitModes','formats']) {
    if(Array.isArray(source[key]))capabilities[key]=source[key].filter(value=>typeof value==='string').map(value=>value)
  }
  if(typeof source.customSize==='boolean')capabilities.customSize=source.customSize
  if(typeof provider.edit==='function')capabilities.edit=true
  if(typeof provider.edit==='function'&&Number.isSafeInteger(source.editMaxImages)&&source.editMaxImages>=1&&source.editMaxImages<=16)capabilities.editMaxImages=source.editMaxImages
  return capabilities
}

async function isAvailable(provider) {
  try {return typeof provider.available==='function'?Boolean(await provider.available()):provider.available!==false}
  catch {return false}
}

async function imageFile(root,inputPath) {
  if(typeof inputPath!=='string'||!isAbsolute(inputPath))throw new Error('Image provider must return an absolute image path')
  const path=await realpath(inputPath),relativePath=assertWithinWorkspace(root,path).replaceAll('\\','/')
  const info=await stat(path)
  if(!info.isFile()||!info.size)throw new Error('Image provider did not return a non-empty image file')
  const handle=await open(path,'r'),head=Buffer.alloc(32)
  try {await handle.read(head,0,head.length,0)}finally{await handle.close()}
  let mime
  if(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png'
  else if(head[0]===255&&head[1]===216&&head[2]===255)mime='image/jpeg'
  else if(head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP')mime='image/webp'
  else if(['GIF87a','GIF89a'].includes(head.toString('ascii',0,6)))mime='image/gif'
  else if(head.toString('ascii',4,8)==='ftyp'&&['avif','avis'].some(brand=>head.subarray(8).includes(Buffer.from(brand))))mime='image/avif'
  if(!mime)throw new Error('Image provider returned an unsupported image file; expected PNG, JPEG, WebP, GIF or AVIF')
  return {path,relativePath,mime}
}

/** Providers own generation, credentials and resizing; callers own permission checks. */
export class ImageService {
  #providers=new Map()
  #onChange
  #enabled
  constructor({onChange=()=>{},enabled=true}={}) {this.#onChange=onChange;this.#enabled=enabled===true}
  register(provider) {
    if(!provider||typeof provider.id!=='string'||!provider.id.trim()||typeof provider.generate!=='function')throw new Error('Image provider requires id and generate')
    if(this.#providers.has(provider.id))throw new Error(`Duplicate image provider: ${provider.id}`)
    this.#providers.set(provider.id,provider)
    this.#onChange()
    return ()=>{if(this.#providers.get(provider.id)===provider){this.#providers.delete(provider.id);this.#onChange()}}
  }
  async list() {
    if(!this.#enabled)return []
    return Promise.all([...this.#providers.values()].map(async provider=>({
      id:provider.id,title:provider.title||provider.id,local:provider.local===true,
      available:await isAvailable(provider),capabilities:capabilitiesOf(provider),
    })))
  }
  async generate(request) {return this.#run(request,'generate')}
  async edit(request) {return this.#run(request,'edit')}
  async #run(request,operation) {
    if(!this.#enabled)throw new Error('Image generation is disabled by host configuration')
    request.signal?.throwIfAborted()
    if(typeof request.prompt!=='string'||!request.prompt.trim())throw new Error('Image prompt must not be empty')
    if(request.size!==undefined&&(typeof request.size!=='string'||!request.size.trim()))throw new Error('Image size must be a non-empty provider-supported size')
    if(request.fit!==undefined&&!['crop','pad'].includes(request.fit))throw new Error('Image fit must be crop or pad')
    if(typeof request.projectPath!=='string'||!isAbsolute(request.projectPath))throw new Error('Image generation requires an absolute workspace path')
    const projectPath=await realpath(request.projectPath)
    if(!(await stat(projectPath)).isDirectory())throw new Error('Image workspace is unavailable')
    if(operation==='edit') {
      if(!Array.isArray(request.images)||request.images.length<1||request.images.length>16)throw new Error('Image editing requires 1–16 workspace image paths')
      const inputs=await Promise.all(request.images.map(path=>imageFile(projectPath,path)))
      if(inputs.some(input=>!['image/png','image/jpeg','image/webp'].includes(input.mime)))throw new Error('Editing inputs must be PNG, JPEG or WebP')
      const mask=request.mask===undefined?undefined:await imageFile(projectPath,request.mask)
      if(mask&&mask.mime!=='image/png')throw new Error('Image mask must be PNG')
      request={...request,images:inputs.map(input=>input.path),mask:mask?.path}
    }
    let provider
    if(request.provider!==undefined) {
      provider=this.#providers.get(request.provider)
      if(!provider||!await isAvailable(provider))throw new Error('Selected image provider is unavailable; use image_providers')
    } else {
      const available=(await this.list()).filter(item=>item.available&&(operation!=='edit'||item.capabilities.edit===true))
      if(!available.length)throw new Error('No image provider is available; configure a provider before generating images')
      if(available.length!==1)throw new Error('Multiple image providers are available; select one explicitly from image_providers')
      provider=this.#providers.get(available[0].id)
    }
    if(!provider||this.#providers.get(provider.id)!==provider)throw new Error('Image provider was unloaded before generation')
    if(typeof provider[operation]!=='function')throw new Error('Selected image provider does not support editing; use image_providers')
    if(operation==='edit'&&request.images.length>(capabilitiesOf(provider).editMaxImages??16))throw new Error('Editing image count exceeds the selected provider capability')
    request.signal?.throwIfAborted()
    const result=await provider[operation]({...request,provider:provider.id,projectPath})
    request.signal?.throwIfAborted()
    if(!result)throw new Error('Image provider did not return an image')
    const image=await imageFile(projectPath,result.path)
    if(operation==='edit'&&[...request.images,request.mask].filter(Boolean).some(path=>process.platform==='win32'?path.toLowerCase()===image.path.toLowerCase():path===image.path))throw new Error('Image editing must save a new file and preserve its inputs')
    if(result.mime!==undefined&&result.mime!==image.mime)throw new Error('Image provider MIME type does not match its file')
    const normalized={...image,provider:provider.id}
    for(const key of ['size','requestedSize','generationSize','sourceSize','resizeWarning']) {
      if(typeof result[key]==='string'&&result[key])normalized[key]=result[key]
    }
    if(typeof result.resized==='boolean')normalized.resized=result.resized
    if(result.sourceRelativePath!==undefined) {
      if(typeof result.sourceRelativePath!=='string'||isAbsolute(result.sourceRelativePath))throw new Error('Source image path must be workspace-relative')
      const sourcePath=resolve(projectPath,result.sourceRelativePath)
      assertWithinWorkspace(projectPath,sourcePath)
      normalized.sourceRelativePath=(await imageFile(projectPath,sourcePath)).relativePath
    }
    request.signal?.throwIfAborted()
    return normalized
  }
}
