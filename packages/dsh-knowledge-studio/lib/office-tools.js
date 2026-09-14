import {randomUUID} from 'node:crypto'
import {copyFile,mkdir,realpath} from 'node:fs/promises'
import {join,relative,isAbsolute} from 'node:path'
import {officeSpec} from './office-spec.js'

// Reuse the optional host Office skills through their governed tools. Never
// locate Python, install packages or bypass a rejected tool execution here.
export async function exportWithOfficeTools(ctx,artifact,directory,format,{execution,signal}={}) {
  const name={docx:'office_document',xlsx:'office_spreadsheet',pptx:'office_presentation'}[format]
  if(!name||!execution?.agent||!ctx.tools?.get(name))return null
  const spec=officeSpec(artifact)
  const call=async arguments_=>{
    signal?.throwIfAborted()
    const result=await ctx.tools.execute({callId:randomUUID(),rootCallId:execution.rootCallId||execution.callId,parent:execution.token,agent:execution.agent,signal,name,arguments:arguments_})
    if(result.isError)throw new Error(result.error?.message||'Office 文件生成未获批准或未完成')
    for(const context of result.additionalContexts||[])execution.deferContext?.(context)
    if(result.concludesTurn)execution.concludeTurn?.()
    return {value:result.value,report:JSON.parse(result.value.reportJSON)}
  }
  const output=`.studio/office/${artifact.id}-${randomUUID().slice(0,8)}.${format}`
  const created=await call({action:'create',output_path:output,spec_json:JSON.stringify(spec)})
  if(created.report.ok!==true||created.value.relativePath!==output)throw new Error('Office 工具未返回预期成果')
  const validation=await call({action:'validate',input_path:output})
  if(validation.report.valid!==true)throw new Error('Office 文件结构验证未通过')
  const inspected=await call({action:'inspect',input_path:output})
  if(inspected.report.ok!==true)throw new Error('Office 文件读取验证未通过')
  const root=await ctx.fs.resolve('.',{cwd:execution.agent.session.header.cwd,signal})
  const source=await ctx.fs.resolve(output,{cwd:execution.agent.session.header.cwd,signal})
  const rootPath=await realpath(ctx.fs.processPath(root)),sourcePath=await realpath(ctx.fs.processPath(source)),rel=relative(rootPath,sourcePath)
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Office 输出超出当前工作区')
  await mkdir(directory,{recursive:true})
  const path=join(directory,`${artifact.id}.${format}`)
  await copyFile(sourcePath,path)
  return {format,path,fileName:`${artifact.id}.${format}`,provider:'office-tools',workspacePath:output,validation:validation.report.summary||{valid:true},...(format==='pptx'?{pageCount:created.report.slide_count,sourcePages:created.report.source_pages,adaptations:created.report.adaptations}:{})}
}
