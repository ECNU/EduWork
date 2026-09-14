import React,{useEffect,useRef,useState} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {StudioIcon,primaryFormats} from './StudioIcon'
import {MindMap} from './MindMap'
import {mindmapPNG} from './mindmap-export'
import {slideOutline} from '../../lib/studio-slides.js'
import {mountOfficePreview,type OfficePreview} from '@eduwork/dsh-artifact-services/office-preview-client'
import {canRetryOfficeExport,officeFormatFor} from '../../lib/export-recovery.js'

const btn:React.CSSProperties={border:'1px solid var(--dsw-alias-border-l2, #ddd7d0)',background:'transparent',borderRadius:7,padding:'6px 9px',font:'inherit',fontSize:12,color:'inherit',cursor:'pointer'}
const secondary:React.CSSProperties={borderTop:'1px solid var(--dsw-alias-border-l2, #e8e2da)',padding:'14px 0',marginTop:12}
const summaryStyle:React.CSSProperties={cursor:'pointer',color:'var(--dsw-alias-label-secondary, #6e655b)',fontSize:12}
const attemptStatus:Record<string,string>={completed:'已生成（中间版本）',failed:'生成失败',cancelled:'已取消',killed:'已停止',interrupted:'已中断',queued:'等待生成',running:'生成中',stopping:'停止中'}
const downloadFormats:Record<string,string[]>={audio:['wav','md','srt','vtt'],video:['mp4','md','srt','vtt'],report:['docx','pdf','md'],slides:['pptx','pdf','md','html'],table:['xlsx','csv'],mindmap:['png','svg','md'],quiz:['md','pdf'],flashcards:['md','pdf']}
const textNames:Record<string,string>={audio:'音频逐字稿',video:'视频分镜与旁白',report:'报告正文',slides:'幻灯片文字与讲稿',table:'表格内容',mindmap:'思维导图文字大纲',quiz:'测验题目与答案',flashcards:'抽认卡正反面'}
function downloadLabel(kind:string,format:string){
  if(format==='md')return `${textNames[kind]||'文稿'} MD`
  if(format==='pdf')return `${({report:'报告',slides:'幻灯片',quiz:'测验题目与答案',flashcards:'抽认卡正反面'} as Record<string,string>)[kind]||'文稿'} PDF`
  return ({wav:'音频 WAV',mp4:'视频 MP4',srt:'字幕 SRT',vtt:'网页字幕 VTT',docx:'报告 DOCX',pptx:'演示文稿 PPTX',xlsx:'数据表 XLSX',csv:'表格数据 CSV',png:'导图图片 PNG',svg:'导图矢量图 SVG',html:'网页预览 HTML'} as Record<string,string>)[format]||format.toUpperCase()
}
const itemsOf=(c:any)=>c?.sections??c?.nodes??c?.rows??c?.slides??c?.segments??c?.scenes??[]
function fileBlob(result:any,format:string) {
  const bytes=Uint8Array.from(atob(result.data),(c:string)=>c.charCodeAt(0))
  const mime:Record<string,string>={poster:'image/jpeg',mp4:'video/mp4',wav:'audio/wav',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'}
  return new Blob([bytes],{type:({svg:'image/svg+xml;charset=utf-8',png:'image/png',md:'text/markdown;charset=utf-8',json:'application/json'} as Record<string,string>)[format]||mime[format]||'application/octet-stream'})
}
function MediaPreview({id,format,exportFile}:{id:string;format:string;exportFile:any}) {
  const [url,setURL]=useState(''),[poster,setPoster]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  const exporter=useRef(exportFile);exporter.current=exportFile
  useEffect(()=>{
    let cancelled=false,objectURL='',posterURL=''
    setURL('');setPoster('');setError('')
    if(format==='mp4')void exporter.current('poster').then((result:any)=>{if(!cancelled){posterURL=URL.createObjectURL(fileBlob(result,'poster'));setPoster(posterURL)}}).catch(()=>{})
    void (async()=>{try{
      const result=await exporter.current(format)
      if(cancelled)return
      objectURL=URL.createObjectURL(fileBlob(result,format));setURL(objectURL)
    }catch(e:any){if(!cancelled)setError(e.message||String(e))}})()
    return ()=>{cancelled=true;if(objectURL)URL.revokeObjectURL(objectURL);if(posterURL)URL.revokeObjectURL(posterURL)}
  },[id,format,attempt])
  return <div data-studio-media-preview style={{marginBottom:20}}>
    {error?<div role="alert" style={{padding:24,background:'var(--dsw-alias-bg-layer-2, #f7f3ed)',borderRadius:10}}>预览暂时不可用。{error}<p><button style={btn} onClick={()=>setAttempt(v=>v+1)}>重试预览</button></p></div>:!url?<div role="status" style={{padding:40,textAlign:'center',background:'var(--dsw-alias-bg-layer-2, #f3eee8)',borderRadius:10}}>正在载入{format==='mp4'?'视频':'音频'}预览…</div>:format==='mp4'?<video controls preload="auto" src={url} poster={poster||undefined} onError={()=>setError('浏览器无法读取此视频，可下载文件查看。')} style={{width:'100%',maxHeight:'65vh',objectFit:'contain',display:'block',background:'#151515',borderRadius:10}}/>:<div style={{padding:24,background:'var(--dsw-alias-bg-layer-2, #f2eef6)',borderRadius:10}}><audio controls preload="metadata" src={url} onError={()=>setError('浏览器无法读取此音频，可下载文件收听。')} style={{width:'100%',display:'block'}}/></div>}
  </div>
}
function OfficeFilePreview({artifact,exportFile,expanded,expand}:any) {
  const format=officeFormatFor(artifact.kind),label=format?.toUpperCase(),savedFile=artifact.exports?.find((file:any)=>file.format===format)?.path
  const [preview,setPreview]=useState<OfficePreview|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  const container=useRef<HTMLDivElement>(null),viewer=useRef<ReturnType<typeof mountOfficePreview>|null>(null)
  const exporter=useRef(exportFile);exporter.current=exportFile
  useEffect(()=>{
    let cancelled=false;setPreview(null);setError('')
    void (async()=>{try{
      const result=await exporter.current('preview')
      if(!cancelled)setPreview(result)
    }catch(error:any){if(!cancelled)setError(error.message||String(error))}})()
    return()=>{cancelled=true}
  },[artifact.id,artifact.status,savedFile,attempt])
  useEffect(()=>{
    if(!preview||!container.current)return
    viewer.current=mountOfficePreview(container.current,{preview,title:`${label} 文件预览`,onExpand:expanded?undefined:expand})
    return()=>{viewer.current?.destroy();viewer.current=null}
  },[preview])
  useEffect(()=>{viewer.current?.update({onExpand:expanded?undefined:expand})},[expanded,expand])
  return <div data-studio-office-preview>
    {error?<div role="alert">{error}{savedFile&&<p>可使用上方下载按钮读取原文件。</p>}<p><button style={btn} onClick={()=>setAttempt(value=>value+1)}>重试预览</button></p></div>:preview?<div ref={container} style={{height:'65vh',minHeight:300}}/>:<p role="status">正在读取 {label} 文件预览…</p>}
    <p style={{fontSize:11,color:'var(--dsw-alias-label-secondary, #80766b)'}}>预览读取已生成的 {label} 文件；复杂排版请在 Office 或 WPS 中查看。</p>
    {artifact.kind==='slides'&&<details style={secondary} data-studio-slide-notes><summary style={summaryStyle}>讲稿与文字大纲 · {artifact.content?.slides?.length} 页</summary>{artifact.content?.slides?.map((slide:any,index:number)=><article key={slide.id||index} style={{padding:'12px 0'}}><h3>第 {index+1} 页{(slide.title||slide.heading||slide.quote)&&` · ${slide.title||slide.heading||slide.quote}`}</h3><ul>{slideOutline(slide).map((text:string,index:number)=><li key={index}>{text}</li>)}</ul>{(slide.notes||slide.speaker_notes)&&<p style={{whiteSpace:'pre-wrap'}}>{slide.notes||slide.speaker_notes}</p>}</article>)}</details>}
  </div>
}
export function StudioArtifact({artifact,back,close,manage,exportFile,askAI,showEvidence,expanded,expand,memory,remember,children}:any) {
  if(!artifact)return <div style={{padding:20}}>正在读取成果… <button style={btn} onClick={back}>返回</button></div>
  return <ArtifactView key={artifact.id} {...{artifact,back,close,manage,exportFile,askAI,showEvidence,expanded,expand,memory,remember,children}}/>
}
function ArtifactView({artifact,back,close,manage,exportFile,askAI,showEvidence,expanded,expand,memory,remember,children}:any) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[rename,setRename]=useState(false),[title,setTitle]=useState(''),[remove,setRemove]=useState(false),[actions,setActions]=useState(false)
  const [download,setDownload]=useState<{url:string;name:string;format:string;identity:string}|null>(null)
  const identity=JSON.stringify([artifact.id,artifact.version??0,(artifact.exports??[]).map((file:any)=>[file.format,file.path])])
  const currentIdentity=useRef(identity);currentIdentity.current=identity
  const mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>()=>{if(download)URL.revokeObjectURL(download.url)},[download])
  useEffect(()=>{setDownload(null);setBusy(false);setError('')},[identity])
  const run=async(fn:any)=>{const requestIdentity=currentIdentity.current;setBusy(true);setError('');try{await fn()}catch(e:any){if(mounted.current&&currentIdentity.current===requestIdentity)setError(e.message||String(e))}finally{if(mounted.current&&currentIdentity.current===requestIdentity)setBusy(false)}}
  const active=['queued','running'].includes(artifact.status),content=artifact.content,primary=primaryFormats[artifact.kind],isMedia=['audio','video'].includes(artifact.kind)
  const retryExport=canRetryOfficeExport(artifact),hasPrimary=artifact.status==='completed'||artifact.exports?.some((file:any)=>file.format===primary)
  const file=async(format:string)=>{
    if(!format)return
    const localPNG=artifact.kind==='mindmap'&&format==='png'
    const result=await exportFile(localPNG?'svg':format)
    const blob=localPNG?await mindmapPNG(fileBlob(result,'svg')):fileBlob(result,format)
    if(!mounted.current||currentIdentity.current!==identity)return
    const url=URL.createObjectURL(blob),name=localPNG?result.fileName.replace(/\.svg$/i,'.png'):result.fileName
    setDownload({url,name,format,identity})
    const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove()
  }
  const formats=(downloadFormats[artifact.kind]||[]).filter(format=>(!isMedia||format==='md'||artifact.exports?.some((file:any)=>file.format===format))&&(!officeFormatFor(artifact.kind)||artifact.status==='completed'||!['docx','pptx','xlsx','html','pdf'].includes(format)))
  const itemLinks=(item:any)=><span style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>{item.evidenceIds?.map((id:string)=>{
    const index=artifact.citations?.findIndex((c:any)=>c.evidenceId===id),c=artifact.citations?.[index];return c?<button key={id} style={{...btn,padding:'2px 6px',fontSize:10}} onClick={()=>showEvidence(c)} title={c.path}>[{index+1}]{c.fresh===false?' 已变化':''}</button>:null
  })}</span>
  const articles=itemsOf(content).map((item:any,index:number)=><article key={item.id} style={{padding:'8px 0 18px'}}>{(item.heading||isMedia)&&<h3 style={{fontSize:isMedia?14:18}}>{item.heading||(item.speaker?`讲述者 ${item.speaker}`:`场景 ${index+1}`)}</h3>}{item.bullets&&<ul>{item.bullets.map((b:string,i:number)=><li key={i}>{b}</li>)}</ul>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:()=>null}}>{item.body||item.text||item.narration||item.notes||''}</ReactMarkdown></article>)

  return <section data-studio-artifact={artifact.kind} style={{height:'100%',minHeight:0,display:'flex',flexDirection:'column',background:'var(--dsw-alias-bg-base, #fffdf9)',color:'var(--dsw-alias-label-primary, #302b28)'}}>
    <header style={{display:'flex',alignItems:'center',gap:8,padding:12,borderBottom:'1px solid var(--dsw-alias-border-l2, #e8e2da)'}}><button style={btn} aria-label="返回 Studio" onClick={back}>←</button><StudioIcon kind={artifact.kind}/><strong style={{fontSize:14,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{artifact.title}</strong><button style={btn} aria-label="关闭成果" onClick={close}>×</button></header>
    <div data-studio-primary-actions style={{display:'flex',gap:6,padding:'10px 12px',flexWrap:'wrap',alignItems:'center',borderBottom:'1px solid var(--dsw-alias-border-l2, #eee)'}}>
      {content&&primary&&hasPrimary&&(!isMedia||artifact.exports?.some((f:any)=>f.format===primary))&&<button data-export-format={primary} style={{...btn,background:'var(--dsw-alias-state-business-primary, #344d60)',color:'var(--dsw-alias-label-primary-inverted, #fff)',borderColor:'var(--dsw-alias-state-business-primary, #344d60)',display:'inline-flex',alignItems:'center',gap:6}} disabled={busy||active} onClick={()=>run(()=>file(primary))}><StudioIcon kind={artifact.kind} size={15}/>下载 {isMedia||artifact.kind==='mindmap'?downloadLabel(artifact.kind,primary):primary.toUpperCase()}</button>}
      {retryExport&&<button data-studio-retry-export style={{...btn,background:'var(--dsw-alias-state-business-primary, #344d60)',color:'var(--dsw-alias-label-primary-inverted, #fff)'}} disabled={busy||active} onClick={()=>run(()=>manage('retry-export',''))}>重试导出</button>}
      {content&&formats.length>0&&<select data-studio-downloads aria-label="下载成果" style={{...btn,maxWidth:'100%'}} disabled={busy} value="" onChange={e=>run(()=>file(e.target.value))}><option value="">下载…</option>{formats.map(format=><option key={format} value={format}>{downloadLabel(artifact.kind,format)}</option>)}</select>}
      {content&&!['quiz','flashcards','mindmap'].includes(artifact.kind)&&<button style={btn} disabled={busy} onClick={()=>run(()=>askAI(''))}>问问 AI</button>}
      {content&&artifact.kind==='mindmap'&&<><button style={btn} data-export-format="md" disabled={busy||active} onClick={()=>run(()=>file('md'))}>下载文字大纲 MD</button><button style={btn} data-export-format="svg" disabled={busy||active} onClick={()=>run(()=>file('svg'))}>下载矢量图 SVG</button></>}
      <button style={{...btn,marginLeft:'auto'}} aria-expanded={actions} disabled={busy} onClick={()=>setActions(!actions)}>更多操作</button>
    </div>
    {actions&&<div style={{display:'flex',gap:6,padding:'8px 12px',flexWrap:'wrap',background:'var(--dsw-alias-bg-layer-2, #f7f3ed)'}}><button style={btn} disabled={busy} onClick={()=>{setTitle(artifact.title);setRename(!rename)}}>重命名</button><button style={btn} disabled={busy} onClick={()=>run(()=>manage(active?'cancel':'retry',''))}>{active?'取消生成':'重新生成'}</button><button style={btn} disabled={busy} onClick={()=>setRemove(!remove)}>移除</button></div>}
    {download?.identity===identity&&<div role="status" style={{padding:'6px 12px',fontSize:11,color:'var(--dsw-alias-label-secondary, #80766b)'}}>文件已准备 · <a style={{color:'var(--dsw-alias-state-business-primary, #344d60)'}} href={download.url} download={download.name}>保存 {download.format.toUpperCase()}</a></div>}
    {rename&&<form style={{display:'flex',padding:12,gap:6}} onSubmit={e=>{e.preventDefault();void run(async()=>{await manage('rename',title);setRename(false)})}}><input aria-label="成果名称" value={title} onChange={e=>setTitle(e.target.value)} style={{minWidth:0,flex:1}}/><button style={btn}>保存</button></form>}
    {remove&&<div style={{padding:12}}>从成果列表移除？<button style={btn} onClick={()=>run(()=>manage('delete',''))}>移除</button><button style={btn} onClick={()=>setRemove(false)}>保留</button></div>}
    {error&&<p role="alert" style={{padding:'0 12px',color:'var(--dsw-alias-state-error-primary, #a02932)'}}>{error}</p>}
    {active&&<p style={{padding:16}}>正在生成 · {artifact.message||artifact.phase}</p>}
    {artifact.exports?.find((f:any)=>f.format==='pptx')?.pageCount&&<p data-studio-file-pages style={{padding:'0 16px',fontSize:12}}>实际文件 · {artifact.exports.find((f:any)=>f.format==='pptx').pageCount} 页{artifact.exports.find((f:any)=>f.format==='pptx').adaptations?.length?' · 已按内容自动换行或续页':''}</p>}
    {artifact.status==='completed'&&artifact.revisionWarning&&<p data-studio-revision-warning role="status" style={{margin:'8px 16px',padding:'10px 12px',border:'1px solid var(--dsw-alias-state-warn-primary, #decba9)',borderRadius:7,background:'var(--dsw-alias-bg-layer-3, #fbf6e9)',color:'var(--dsw-alias-state-warn-label, #795b2f)',fontSize:12,overflowWrap:'anywhere'}}>{artifact.revisionWarning}</p>}
    {artifact.attempts?.length>0&&<details data-studio-attempt-history style={{padding:'8px 16px',fontSize:12}}><summary>修改记录 · {artifact.attempts.length} 条</summary>{artifact.attempts.map((attempt:any,index:number)=><p key={`${attempt.version??'legacy'}:${index}`} data-studio-attempt-version={attempt.version} style={{overflowWrap:'anywhere'}}>{Number.isInteger(attempt.version)&&attempt.version>0?`第 ${attempt.version} 版`:'历史尝试'} · {attemptStatus[attempt.status]||'未完成'}{attempt.message?`：${attempt.message}`:''}</p>)}</details>}
    {!active&&artifact.status!=='completed'&&<div role="alert" style={{padding:16,color:'var(--dsw-alias-state-error-primary, #a02932)'}}>{artifact.status==='cancelled'?'已取消。':'生成未完成。'}{content?'已保留生成的文本，可展开查看。':''}{artifact.message&&<details style={{marginTop:8}}><summary>查看原因</summary><div style={{maxHeight:140,overflow:'auto',overflowWrap:'anywhere',fontSize:12}}>{artifact.message}</div></details>}</div>}
    {retryExport&&<p style={{padding:'0 16px',fontSize:12}}>正文已保存。重试导出会使用这份正文，不调用模型；“重新生成”会重新生成内容并消耗模型额度。</p>}
    {artifact.draft?.text&&<details data-studio-draft style={{padding:14,borderBottom:'1px solid var(--dsw-alias-border-l2, #ddd)'}}><summary style={summaryStyle}>{artifact.exportState?.validatedAt?'生成原文 · 正文已校验':retryExport?'生成原文 · 导出未完成':'未完成草稿 · 尚未校验'}</summary><p style={{fontSize:12}}>原始文本已保留，可下载查看。{artifact.draft.text.length>10000?'下方预览前 10000 字符，下载包含全部草稿。':''}</p><button style={btn} disabled={busy} onClick={()=>run(()=>file('draft'))}>下载完整草稿</button><pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap',fontSize:12}}>{artifact.draft.text.slice(0,10000)}</pre></details>}
    {['quiz','flashcards'].includes(artifact.kind)?<div style={{flex:1,minHeight:0}}>{artifact.status==='completed'?children:null}</div>:<div style={{overflow:'auto',padding:18,flex:1,fontSize:13,lineHeight:1.7}}>
      {isMedia&&artifact.exports?.some((f:any)=>f.format===primary)&&<MediaPreview id={`${artifact.id}:${artifact.version??0}:${artifact.exports.find((f:any)=>f.format===primary).path??''}`} format={primary} exportFile={exportFile}/>}
      {isMedia&&content?<details style={secondary} data-studio-script><summary style={summaryStyle}>{artifact.kind==='video'?'分镜与旁白':'逐字稿'} · {itemsOf(content).length} {artifact.kind==='video'?'个场景':'段'}</summary>{articles}</details>:officeFormatFor(artifact.kind)&&artifact.exports?.some((file:any)=>file.format===officeFormatFor(artifact.kind))?<OfficeFilePreview {...{artifact,exportFile,expanded,expand}}/>:artifact.kind==='mindmap'?content&&<MindMap {...{artifact,askAI,showEvidence,expanded,expand,memory,remember}}/>:artifact.kind==='table'?<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr>{content?.columns.map((c:string,i:number)=><th key={i} style={{padding:10,borderBottom:'2px solid var(--dsw-alias-border-l2, #ccc)',textAlign:'left',background:'var(--dsw-alias-bg-layer-2, #edf3ef)'}}>{c}</th>)}</tr></thead><tbody>{content?.rows.map((row:any)=><tr key={row.id}>{row.cells.map((cell:string,i:number)=><td key={i} style={{padding:10,borderBottom:'1px solid var(--dsw-alias-border-l2, #e8e2da)',minWidth:90}}>{cell}</td>)}</tr>)}</tbody></table></div>:articles}
      {content&&artifact.citations?.length>0&&<details style={secondary} data-studio-sources><summary style={summaryStyle}>参考来源 · {new Set(artifact.citations?.map((c:any)=>c.path)).size} 份资料</summary><p style={{fontSize:11,color:'var(--dsw-alias-label-secondary, #80766b)'}}>{artifact.sourceScope}</p>{artifact.citations?.map((c:any,index:number)=><div key={c.evidenceId} style={{padding:'10px 0',borderBottom:'1px solid var(--dsw-alias-border-l2, #eee)',overflowWrap:'anywhere'}}><button style={{...btn,textAlign:'left',border:0,padding:0}} onClick={()=>showEvidence(c)}>[{index+1}] {c.path} · {c.locator==='page'?`第 ${c.pageStart} 页`:`第 ${c.lineStart} 行`}{c.fresh===false?' · 原文已变化':''}</button><p style={{fontSize:11,color:'var(--dsw-alias-label-secondary, #80766b)',margin:'5px 0'}}>{itemsOf(content).filter((item:any)=>item.evidenceIds?.includes(c.evidenceId)).map((item:any)=>item.title||item.heading||item.label||(artifact.kind==='table'?`第 ${content.rows.indexOf(item)+1} 行`:artifact.kind==='audio'?`第 ${content.segments.indexOf(item)+1} 段`:item.id)).join('、')}</p></div>)}</details>}
    </div>}
  </section>
}
