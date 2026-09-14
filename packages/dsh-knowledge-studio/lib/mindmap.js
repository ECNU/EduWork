// Shared by the interactive view and full SVG/PNG exports. No DOM or network.
export const MINDMAP_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
export const escapeXML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const colors=['#447d89','#70619b','#a36b38','#4b8061','#a25c78','#5272a0']

/** Read legacy forests without mutating stored nodes, citations or parent IDs. */
export function mindmapTree(content) {
  const input=Array.isArray(content?.nodes)?content.nodes:[]
  const used=new Set(),nodes=input.map((source,index)=>{
    let id=String(source.id||`node-${index+1}`)
    while(used.has(id))id+='-copy'
    used.add(id)
    return {...source,id,label:String(source.label||source.heading||'未命名节点'),body:String(source.body||''),children:[],parentId:String(source.parentId||'')}
  })
  const byId=new Map(nodes.map(node=>[node.id,node]))
  for(const node of nodes) {
    const seen=new Set([node.id]);let parent=node.parentId
    while(parent) {
      if(!byId.has(parent)||seen.has(parent)){node.parentId='';break}
      seen.add(parent);parent=byId.get(parent).parentId
    }
  }
  for(const node of nodes)if(node.parentId)byId.get(node.parentId).children.push(node)
  return {nodes,roots:nodes.filter(node=>!node.parentId),byId}
}

function wrapLabel(label,budget) {
  const lines=[];let line='',width=0
  for(const char of String(label)) {
    if(char==='\n'){lines.push(line);line='';width=0;continue}
    const size=/[\u0020-\u007e]/u.test(char)?0.6:1
    if(width+size>budget&&line){lines.push(line.trimEnd());line='';width=0}
    line+=char;width+=size
  }
  if(line||!lines.length)lines.push(line.trimEnd())
  return lines
}

export function layoutMindmap(content,{collapsed=[]}={}) {
  const tree=mindmapTree(content),hidden=new Set(collapsed)
  let virtualId='__studio_root__'
  while(tree.byId.has(virtualId))virtualId+='_'
  const root=tree.roots.length===1?tree.roots[0]:{id:virtualId,label:content?.title||'思维导图',body:'',children:tree.roots,parentId:'',virtual:true}
  const prepare=(node,depth=0,color='#344d60')=>{
    const fontSize=depth===0?18:14,width=depth===0?232:220
    const lines=wrapLabel(node.label,Math.floor((width-28)/fontSize))
    const children=hidden.has(node.id)?[]:node.children.map(child=>prepare(child,depth+1,color))
    const height=Math.max(48,lines.length*(fontSize+6)+24)
    return {...node,children,depth,color,width,height,fontSize,lines,childCount:node.children.length,collapsed:hidden.has(node.id),span:Math.max(height,children.reduce((sum,child)=>sum+child.span,0)+Math.max(0,children.length-1)*20)}
  }
  const prepared=prepare(root),nodes=[],edges=[]
  const place=(node,x,y,direction,color)=>{
    const placed={...node,x,y,color};nodes.push(placed)
    let cursor=y-(node.children.reduce((sum,child)=>sum+child.span,0)+Math.max(0,node.children.length-1)*20)/2
    for(const child of node.children) {
      const cx=x+direction*(node.width/2+72+child.width/2),cy=cursor+child.span/2
      edges.push({parentId:node.id,childId:child.id,color,from:{x:x+direction*node.width/2,y},to:{x:cx-direction*child.width/2,y:cy}})
      place(child,cx,cy,direction,color);cursor+=child.span+20
    }
  }
  nodes.push({...prepared,x:0,y:0,color:'#344d60'})
  const sides=[[],[]],heights=[0,0]
  prepared.children.forEach((node,index)=>{const side=heights[0]<=heights[1]?0:1;sides[side].push({...node,color:colors[index%colors.length]});heights[side]+=node.span+20})
  sides.forEach((children,side)=>{
    const direction=side===0?1:-1;let cursor=-(heights[side]-20)/2
    for(const child of children) {
      const x=direction*(prepared.width/2+72+child.width/2),y=cursor+child.span/2
      edges.push({parentId:prepared.id,childId:child.id,color:child.color,from:{x:direction*prepared.width/2,y:0},to:{x:x-direction*child.width/2,y}})
      place(child,x,y,direction,child.color);cursor+=child.span+20
    }
  })
  const minX=Math.min(...nodes.map(n=>n.x-n.width/2))-40,minY=Math.min(...nodes.map(n=>n.y-n.height/2))-40
  const width=Math.ceil(Math.max(...nodes.map(n=>n.x+n.width/2))-minX+40),height=Math.ceil(Math.max(...nodes.map(n=>n.y+n.height/2))-minY+40)
  for(const node of nodes){node.x-=minX+node.width/2;node.y-=minY+node.height/2}
  for(const edge of edges) {
    const a={x:edge.from.x-minX,y:edge.from.y-minY},b={x:edge.to.x-minX,y:edge.to.y-minY},middle=(a.x+b.x)/2
    edge.path=`M ${a.x} ${a.y} C ${middle} ${a.y}, ${middle} ${b.y}, ${b.x} ${b.y}`
  }
  return {width,height,nodes,edges,rootId:prepared.id,total:tree.nodes.length}
}

export function mindmapSVG(content,title=content?.title||'思维导图') {
  const layout=layoutMindmap(content)
  const edges=layout.edges.map(edge=>`<path data-mindmap-edge="true" data-parent-id="${escapeXML(edge.parentId)}" data-child-id="${escapeXML(edge.childId)}" d="${edge.path}" stroke="${edge.color}" stroke-width="2" fill="none"/>`).join('')
  const nodes=layout.nodes.map(node=>`<g data-mindmap-node="true" data-node-id="${escapeXML(node.id)}" data-parent-id="${escapeXML(node.parentId)}"><title>${escapeXML(node.label)}</title><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${node.depth===0?'#344d60':'#f9fafb'}" stroke="${node.color}" stroke-width="1.5"/><text x="${node.x+14}" y="${node.y+18+node.fontSize}" fill="${node.depth===0?'#ffffff':'#263642'}" font-family="${escapeXML(MINDMAP_FONT)}" font-size="${node.fontSize}" font-weight="${node.depth<2?600:400}">${node.lines.map((line,index)=>`<tspan x="${node.x+14}" dy="${index?node.fontSize+6:0}">${escapeXML(line)}</tspan>`).join('')}</text></g>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img"><title>${escapeXML(title)}</title><desc>${layout.total} 个原始节点，完整展开的思维导图。节点正文和来源见 Markdown 或 JSON。</desc><rect width="100%" height="100%" fill="#ffffff"/>${edges}${nodes}</svg>`
}

export function mindmapPNGSize(width,height) {
  const scale=Math.min(2,8192/width,8192/height,Math.sqrt(24_000_000/(width*height)))
  return {width:Math.ceil(width*scale),height:Math.ceil(height*scale),scale}
}

export function mindmapMarkdown(artifact) {
  const {roots}=mindmapTree(artifact.content)
  const escape=value=>String(value??'').replace(/([\\`*_\[\]<>])/g,'\\$1').replace(/[\r\n]+/g,' ')
  const lines=[`# ${escape(artifact.title)}`,'']
  const visit=(node,depth)=>{
    const indent='  '.repeat(depth)
    lines.push(`${indent}- **${escape(node.label)}**`)
    if(node.body)lines.push('',...node.body.split('\n').map(line=>`${indent}  ${line}`))
    if(node.evidenceIds?.length) {
      const citations=node.evidenceIds.map(id=>{
        const source=artifact.citations?.find(item=>item.evidenceId===id)
        return source?`${escape(source.path)}（${source.locator==='page'?'P'+source.pageStart:'L'+source.lineStart}；${escape(id)}）`:escape(id)
      })
      lines.push('',`${indent}  来源：${citations.join('；')}`)
    }
    lines.push('');node.children.forEach(child=>visit(child,depth+1))
  }
  roots.forEach(node=>visit(node,0))
  return lines.join('\n')
}
