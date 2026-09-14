import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {layoutMindmap,mindmapTree,MINDMAP_FONT} from '../../lib/mindmap.js'

const button:React.CSSProperties={border:'1px solid var(--dsw-alias-border-l2, #d4dce1)',borderRadius:7,background:'var(--dsw-alias-bg-base, #fff)',color:'var(--dsw-alias-state-business-primary, #344d60)',padding:'6px 9px',font:'inherit',fontSize:12,cursor:'pointer',minHeight:32}
type Camera={x:number;y:number;zoom:number}
export function MindMap({artifact,showEvidence,askAI,expanded,expand,memory={},remember=()=>{}}:any) {
  const content=artifact.content,signature=JSON.stringify(content)
  const [collapsed,setCollapsed]=useState<string[]>(memory.collapsed||[]),[selected,setSelected]=useState(memory.selected||''),[mode,setMode]=useState(memory.mode||'map')
  const [camera,setCamera]=useState<Camera>(memory.camera||{x:0,y:0,zoom:1}),[size,setSize]=useState({width:0,height:0})
  const [error,setError]=useState('')
  const svg=useRef<SVGSVGElement>(null),container=useRef<HTMLDivElement>(null),restore=useRef(true),callbacks=useRef({remember,askAI,showEvidence})
  callbacks.current={remember,askAI,showEvidence}
  const drag=useRef<{x:number;y:number;camera:Camera;pointer:number;moved:boolean}|null>(null),suppress=useRef(false)
  const tree=useMemo(()=>mindmapTree(content),[signature])
  const layout=useMemo(()=>layoutMindmap(content,{collapsed}),[signature,collapsed])
  const selectedNode=tree.byId.get(selected)
  const focusId=layout.nodes.some(node=>node.id===selected)?selected:layout.rootId
  const fit=()=>{const zoom=Math.max(.03,Math.min((size.width-20)/layout.width,(size.height-20)/layout.height,1.2));return {zoom,x:(size.width-layout.width*zoom)/2,y:(size.height-layout.height*zoom)/2}}
  useLayoutEffect(()=>{
    const element=container.current;if(!element)return
    const measure=()=>{const box=element.getBoundingClientRect();setSize(previous=>previous.width===box.width&&previous.height===box.height?previous:{width:box.width,height:box.height})}
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()
  },[mode])
  useEffect(()=>{
    if(!size.width||!size.height)return
    if(restore.current&&memory.camera&&memory.width===size.width&&memory.height===size.height)setCamera(memory.camera)
    else {
      // Keep initial labels readable. Fitting the entire tree is an explicit
      // overview action; narrow panels can pan or expand the reading surface.
      const focus=layout.nodes.find(node=>node.id===focusId)!,zoom=Math.max(.8,Math.min(1,fit().zoom))
      setCamera({zoom,x:size.width/2-(focus.x+focus.width/2)*zoom,y:size.height/2-(focus.y+focus.height/2)*zoom})
    }
    restore.current=false
  },[layout,size])
  useEffect(()=>{
    if(size.width)callbacks.current.remember({selected,collapsed,mode,camera,width:size.width,height:size.height})
  },[selected,collapsed,mode,camera,size])
  const zoomAt=(factor:number,x=size.width/2,y=size.height/2)=>setCamera(current=>{
    const zoom=Math.min(4,Math.max(.03,current.zoom*factor)),ratio=zoom/current.zoom
    return {zoom,x:x-(x-current.x)*ratio,y:y-(y-current.y)*ratio}
  })
  useEffect(()=>{
    const element=svg.current;if(!element)return
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();const box=element.getBoundingClientRect()
      zoomAt(event.deltaY<0?1.15:1/1.15,event.clientX-box.left,event.clientY-box.top)
    }
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel)
  },[mode,size])
  const toggle=(id:string)=>setCollapsed(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])
  const choose=(id:string,focus=false)=>{
    setSelected(id)
    if(focus){const node=layout.nodes.find(node=>node.id===id);if(node)setCamera(current=>({...current,x:size.width/2-(node.x+node.width/2)*current.zoom,y:size.height/2-(node.y+node.height/2)*current.zoom}));Array.from(svg.current?.querySelectorAll<SVGGElement>('[data-mindmap-node]')||[]).find(node=>node.dataset.nodeId===id)?.focus({preventScroll:true})}
  }
  const keyboard=(event:React.KeyboardEvent,id:string)=>{
    const node=tree.byId.get(id),index=layout.nodes.findIndex(item=>item.id===id)
    if(event.key==='Enter'){event.preventDefault();choose(id);return}
    if(event.key===' '){event.preventDefault();if(node?.children.length)toggle(id);return}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(event.key))return
    event.preventDefault()
    if(event.key==='ArrowRight'&&node?.children.length){if(collapsed.includes(id))toggle(id);else choose(node.children[0].id,true)}
    else if(event.key==='ArrowLeft'&&node){if(node.children.length&&!collapsed.includes(id))toggle(id);else if(node.parentId)choose(node.parentId,true)}
    else choose(event.key==='Home'?layout.rootId:layout.nodes[Math.max(0,Math.min(layout.nodes.length-1,index+(event.key==='ArrowUp'?-1:1)))].id,true)
  }
  const run=async(fn:()=>Promise<any>)=>{setError('');try{await fn()}catch(error:any){setError(error.message||String(error))}}
  const outline=(node:any):React.ReactNode=><li key={node.id} data-outline-node={node.id}><button style={{...button,border:0,textAlign:'left',fontWeight:selected===node.id?700:400}} aria-pressed={selected===node.id} onClick={()=>choose(node.id)}>{node.label}</button>{node.children.length>0&&<ul>{node.children.map(outline)}</ul>}</li>
  return <div data-mindmap-view>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
      <button style={button} aria-pressed={mode==='map'} onClick={()=>setMode('map')}>思维导图</button><button style={button} aria-pressed={mode==='outline'} onClick={()=>setMode('outline')}>文字大纲</button>
      {!expanded&&expand&&<button style={{...button,marginLeft:'auto'}} onClick={expand}>展开阅读导图</button>}
    </div>
    {mode==='map'?<>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:8}}>
        <button style={button} aria-label="缩小导图" onClick={()=>zoomAt(1/1.25)}>−</button><output aria-label="导图缩放比例" style={{fontSize:11,minWidth:35,textAlign:'center'}}>{Math.round(camera.zoom*100)}%</output><button style={button} aria-label="放大导图" onClick={()=>zoomAt(1.25)}>+</button>
        <button style={button} onClick={()=>setCamera(fit())}>适应视图</button><button style={button} onClick={()=>setCollapsed([])}>展开全部</button><button style={button} onClick={()=>{setCollapsed(tree.nodes.filter(node=>node.parentId&&node.children.length).map(node=>node.id));setSelected('')}}>收起分支</button>
      </div>
      <div ref={container} style={{height:'clamp(300px,52vh,640px)',minWidth:0,border:'1px solid var(--dsw-alias-border-l2,#dce3e8)',borderRadius:10,overflow:'hidden',background:'var(--dsw-alias-bg-base,#fff)'}}>
        <svg ref={svg} data-mindmap-canvas data-zoom={camera.zoom} data-pan-x={camera.x} data-pan-y={camera.y} data-visible-nodes={layout.nodes.length} data-total-nodes={layout.total}
          role="group" aria-label={`${artifact.title}，思维导图。点击节点查看详情；方向键选择节点，空格折叠分支。`} viewBox={`0 0 ${size.width||1} ${size.height||1}`} style={{width:'100%',height:'100%',display:'block',touchAction:'none',cursor:'grab'}}
          onPointerDown={event=>{if(event.button!==0)return;suppress.current=false;drag.current={x:event.clientX,y:event.clientY,camera,pointer:event.pointerId,moved:false}}}
          onPointerMove={event=>{const start=drag.current;if(!start||event.pointerId!==start.pointer)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!start.moved&&Math.hypot(dx,dy)<4)return;start.moved=true;suppress.current=true;event.currentTarget.setPointerCapture(event.pointerId);setCamera({...start.camera,x:start.camera.x+dx,y:start.camera.y+dy})}}
          onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drag.current=null}}
          onPointerCancel={()=>{drag.current=null}}>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
            {layout.edges.map(edge=><path key={edge.childId} data-mindmap-edge data-parent-id={edge.parentId} data-child-id={edge.childId} d={edge.path} stroke="var(--dsw-alias-label-tertiary,#74818b)" strokeWidth={2} fill="none"/>)}
            {layout.nodes.map(node=><g key={node.id} data-mindmap-node data-node-id={node.id} data-parent-id={node.parentId} role="button" aria-label={node.label} aria-pressed={selected===node.id} aria-expanded={node.childCount? !node.collapsed:undefined} tabIndex={node.id===focusId?0:-1}
              onClick={()=>{if(!suppress.current)choose(node.id)}} onDoubleClick={()=>{if(node.childCount)toggle(node.id)}} onKeyDown={event=>keyboard(event,node.id)} style={{cursor:'pointer',outlineOffset:4}}>
              <title>{node.label}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx={12} fill={node.depth===0?'var(--dsw-alias-state-business-primary,#3777ba)':selected===node.id?'var(--dsw-alias-interactive-bg-active,#eaf2f7)':'var(--dsw-alias-bg-layer-2,#f9fafb)'} stroke={selected===node.id?'var(--dsw-alias-state-business-primary,#3777ba)':'var(--dsw-alias-border-l2,#74818b)'} strokeWidth={selected===node.id?3:1.5}/>
              <text x={node.x+14} y={node.y+18+node.fontSize} fill={node.depth===0?'var(--dsw-alias-label-primary-inverted,#fff)':'var(--dsw-alias-label-primary,#263642)'} fontFamily={MINDMAP_FONT} fontSize={node.fontSize} fontWeight={node.depth<2?600:400} style={{userSelect:'none'}}>{node.lines.map((line:string,index:number)=><tspan key={index} x={node.x+14} dy={index?node.fontSize+6:0}>{line}</tspan>)}</text>
              {node.childCount>0&&<g aria-hidden="true" onClick={event=>{event.stopPropagation();if(!suppress.current)toggle(node.id)}}><circle cx={node.x+node.width-4} cy={node.y+node.height-4} r={10} fill="var(--dsw-alias-bg-base,#fff)" stroke="var(--dsw-alias-state-business-primary,#3777ba)"/><text x={node.x+node.width-4} y={node.y+node.height} textAnchor="middle" fill="var(--dsw-alias-state-business-primary,#3777ba)" fontSize={14}>{node.collapsed?'+':'−'}</text></g>}
            </g>)}
          </g>
        </svg>
      </div>
      <p style={{fontSize:11,color:'var(--dsw-alias-label-secondary, #74818b)',margin:'7px 0'}}>{layout.total} 个节点 · 拖动查看分支，滚轮缩放。“适应视图”查看全图概览；导出始终包含完整导图。</p>
    </>:<nav data-mindmap-outline aria-label="思维导图文字大纲" style={{maxHeight:'60vh',overflow:'auto',background:'var(--dsw-alias-bg-layer-2, #f7f9fa)',borderRadius:8,padding:10}}><ul style={{paddingLeft:16}}>{tree.roots.map(outline)}</ul></nav>}
    {selectedNode?<section data-mindmap-node-detail style={{border:'1px solid var(--dsw-alias-border-l2, #dce3e8)',borderRadius:10,padding:14,marginTop:12,overflowWrap:'anywhere'}}>
      <div style={{display:'flex',alignItems:'start',gap:8}}><strong style={{flex:1}}>{selectedNode.label}</strong><button style={button} aria-label="关闭节点详情" onClick={()=>setSelected('')}>×</button></div>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:()=>null}}>{selectedNode.body||'此节点暂无补充说明。'}</ReactMarkdown>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{selectedNode.children.length>0&&<button style={button} onClick={()=>toggle(selectedNode.id)}>{collapsed.includes(selectedNode.id)?'展开子节点':'收起子节点'}</button>}<button style={button} onClick={()=>void run(()=>callbacks.current.askAI(selectedNode.id))}>围绕此节点提问</button></div>
      {selectedNode.evidenceIds?.length>0&&<div style={{marginTop:12,fontSize:12}}>节点来源{selectedNode.evidenceIds.map((id:string)=>{
        const citation=artifact.citations?.find((item:any)=>item.evidenceId===id)
        return citation?<button key={id} style={{...button,display:'block',marginTop:6,textAlign:'left',maxWidth:'100%',overflowWrap:'anywhere'}} onClick={()=>void run(()=>callbacks.current.showEvidence(citation))}>{citation.path} · {citation.locator==='page'?'P'+citation.pageStart:'L'+citation.lineStart}{citation.fresh===false?' · 原文已变化':''}</button>:null
      })}</div>}
    </section>:<p style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #74818b)'}}>选择一个节点，查看正文、来源或继续提问。</p>}
    {error&&<p role="alert" style={{color:'var(--dsw-alias-state-error-primary, #a02932)'}}>{error}</p>}
  </div>
}
