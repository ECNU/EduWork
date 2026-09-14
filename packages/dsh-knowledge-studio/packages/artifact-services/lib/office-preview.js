import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {readFile,open,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,extname,dirname,resolve} from 'node:path'
import {privatePython} from './office.js'

const MAX_OFFICE_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_OFFICE_PREVIEW_BYTES = 24 * 1024 * 1024
const cache = new Map()
const CACHE_BYTES = 64 * 1024 * 1024
const CACHE_TTL = 5 * 60 * 1000
const digest = value => createHash('sha256').update(value).digest('hex')
const rendererPath = fileURLToPath(new URL('../python/dsh_office/documents/render_preview.py', import.meta.url))
const decode = value => String(value).replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|#39);/gi, (match,named,entity) => {
  if(named){const code=named[0].toLowerCase()==='x'?parseInt(named.slice(1),16):Number(named);return code<=0x10ffff?String.fromCodePoint(code):match}
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"})[entity.toLowerCase()]||match
})
function attribute(tag, name) {return decode(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1]||'')}
function describe(html, identity) {
  const main=html.match(/<main\b[^>]*\bdata-slide-width\s*=[^>]*>/i)?.[0]
  const pageWidth=Number(attribute(main||'','data-slide-width')),pageHeight=Number(attribute(main||'','data-slide-height'))
  const pageCount=Number(attribute(main||'','data-slide-count'))
  if(main&&(!Number.isFinite(pageWidth)||!Number.isFinite(pageHeight)||pageWidth<=0||pageHeight<=0||pageWidth>100000||pageHeight>100000||!Number.isInteger(pageCount)||pageCount<1||pageCount>10000))throw new Error('Office 预览返回了无效页面尺寸或页数')
  const warnings=[]
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bdata-office-warning-code\s*=[^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const code=attribute(match[2],'data-office-warning-code')||'unsupported-object'
    const message=attribute(match[2],'data-office-warning')||decode(match[3].replace(/<[^>]*>/g,'')).trim()
    if(message&&!warnings.some(warning=>warning.code===code&&warning.message===message))warnings.push({code,message})
  }
  return {schemaVersion:1,kind:main?'slides':'document',...identity,pageCount:main?pageCount:null,pageWidth:main?pageWidth:null,pageHeight:main?pageHeight:null,warnings}
}

export function assertOfficeSourceSize(size) {
  if (Number.isFinite(size) && size > MAX_OFFICE_SOURCE_BYTES) {
    throw new Error('Office 文件超过 64 MB，请使用本机应用打开')
  }
}

export async function renderOfficePreview(filePath, signal, runtime = { execFile, environment: process.env }) {
  signal?.throwIfAborted()
  const environment=runtime.environment||process.env
  let python
  try {python=privatePython(environment)} catch(error){throw new Error('Office 预览运行时尚未就绪，请稍后重试',{cause:error})}
  if (typeof python !== 'string' || python.trim() === '') {
    throw new Error('Office 预览运行时尚未就绪，请稍后重试')
  }
  // Read and authorize at the caller on every request; a cache hit never bypasses
  // reading the current file. Convert these exact bytes in an isolated snapshot.
  const handle=await open(filePath,'r')
  let source
  try {assertOfficeSourceSize((await handle.stat()).size);source=await handle.readFile();assertOfficeSourceSize(source.length)} finally {await handle.close()}
  signal?.throwIfAborted()
  const sourceHash=digest(source),rendererVersion='fixed-page-v1:'+digest(await readFile(rendererPath))
  const fontFingerprint=digest(JSON.stringify({platform:process.platform,python,fonts:environment.DSH_OFFICE_FONT_FINGERPRINT||'system-default',config:environment.FONTCONFIG_FILE||'',path:environment.FONTCONFIG_PATH||'',locale:environment.LANG||''}))
  const extension=extname(filePath).toLowerCase()
  const cacheKey=digest(JSON.stringify([sourceHash,rendererVersion,fontFingerprint,extension]))
  const previous=cache.get(cacheKey)
  if(previous&&Date.now()-previous.at<CACHE_TTL){cache.delete(cacheKey);cache.set(cacheKey,previous);return structuredClone(previous.value)}
  const directory=await mkdtemp(join(tmpdir(),'dsh-office-preview-'))
  try {
    const snapshot=join(directory,'source'+extension)
    await writeFile(snapshot,source)
    signal?.throwIfAborted()
    const args = ['-I', '-X', 'utf8', fileURLToPath(new URL('../python/runner.py',import.meta.url)), 'documents.render_preview', '--input', snapshot]
    const value=await new Promise((resolve, reject) => {
    ;(runtime.execFile||execFile)(python, args, {
      encoding: 'utf8', windowsHide: true, timeout: 45_000,
      maxBuffer: MAX_OFFICE_PREVIEW_BYTES, signal, env:environment,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = String(stderr ?? '').trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 800)
        reject(new Error(`Office 预览生成失败${detail ? `：${detail}` : ''}`))
        return
      }
      const html = String(stdout ?? '')
      if (!html.startsWith('<!doctype html>')) {
        reject(new Error('Office 预览运行时返回了无效内容'))
        return
      }
      try {resolve({ html, bytes: Buffer.byteLength(html, 'utf8'),description:describe(html,{sourceHash,rendererVersion,fontFingerprint,cacheKey}) })}catch(error){reject(error)}
    })
  })
    signal?.throwIfAborted()
    if(rendererVersion!=='fixed-page-v1:'+digest(await readFile(rendererPath)))throw new Error('Office 预览转换器已更新，请重新读取文件')
    cache.set(cacheKey,{at:Date.now(),value})
    let total=[...cache.values()].reduce((sum,item)=>sum+item.value.bytes,0)
    for(const [key,item] of cache){if(cache.size<=8&&total<=CACHE_BYTES&&Date.now()-item.at<CACHE_TTL)break;cache.delete(key);total-=item.value.bytes}
    return structuredClone(value)
  } finally {
    if(dirname(directory)===resolve(tmpdir())&&directory.startsWith(join(tmpdir(),'dsh-office-preview-')))await rm(directory,{recursive:true,force:true})
  }
}

export { MAX_OFFICE_PREVIEW_BYTES, MAX_OFFICE_SOURCE_BYTES }
