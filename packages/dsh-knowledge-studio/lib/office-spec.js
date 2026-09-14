import {unified} from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import {normalizeSlide} from './studio-slides.js'

const parser=unified().use(remarkParse).use(remarkGfm)
const text=node=>node.value??(node.children||[]).map(text).join('')
function runs(node,style={}) {
  if(node.type==='image'||node.type==='html')return []
  if(node.type==='break')return [{text:'\n',...style}]
  if(node.type==='strong')style={...style,bold:true}
  if(node.type==='emphasis')style={...style,italic:true}
  if(node.type==='inlineCode')style={...style,font:'Consolas'}
  return node.children?node.children.flatMap(child=>runs(child,style)):[{text:node.value||'',...style}]
}
export function markdownBlocks(markdown) {
  const convert=(nodes,depth=0)=>nodes.flatMap(node=>{
    if(node.type==='heading')return [{type:'heading',level:Math.min(6,node.depth+1),text:text(node)}]
    if(node.type==='paragraph')return [{type:'paragraph',runs:runs(node)}]
    if(node.type==='list')return node.children.flatMap((item,index)=>[
      {type:'paragraph',runs:[{text:`${'  '.repeat(depth)}${node.ordered?`${(node.start||1)+index}.`:'•'} `},...item.children.filter(n=>n.type!=='list').flatMap(n=>runs(n))]},
      ...convert(item.children.filter(n=>n.type==='list'),depth+1),
    ])
    if(node.type==='table')return [{type:'table',header:true,rows:node.children.map(row=>row.children.map(text))}]
    if(node.type==='blockquote')return convert(node.children,depth)
    if(node.type==='code')return [{type:'paragraph',runs:[{text:node.value,font:'Consolas'}]}]
    return []
  })
  return convert(parser.parse(String(markdown||'')).children)
}
export function officeSpec(artifact) {
  const c=artifact.content,citations=artifact.citations||[]
  if(artifact.kind==='report')return {
    properties:{title:artifact.title,author:'Knowledge Studio'},page_numbers:true,
    defaults:{font:'Aptos',east_asia_font:'Microsoft YaHei',font_size_pt:11},
    page:{orientation:'portrait',margins_cm:{top:2.54,right:2.54,bottom:2.54,left:2.54}},
    blocks:[{type:'title',text:artifact.title},...c.sections.flatMap(section=>[
      ...(section.heading?[{type:'heading',level:1,text:section.heading}]:[]),...markdownBlocks(section.body),
      ...(section.evidenceIds?.some(id=>citations.some(c=>c.evidenceId===id))?[{type:'paragraph',text:'参考：'+section.evidenceIds.map(id=>citations.findIndex(c=>c.evidenceId===id)+1).filter(n=>n>0).map(n=>`[${n}]`).join(' ')}]:[]),
    ]),...(citations.length?[{type:'heading',level:1,text:'参考来源'},...citations.map((s,i)=>({type:'paragraph',text:`[${i+1}] ${s.path} · ${s.locator==='page'?`第 ${s.pageStart} 页`:`第 ${s.lineStart} 行`}\n${s.excerpt||''}`}))]:[])],
  }
  if(artifact.kind==='table')return {properties:{title:artifact.title,creator:'Knowledge Studio'},sheets:[
    {name:'数据',rows:[c.columns.map(value=>({type:'text',value:String(value)})),...c.rows.map(row=>row.cells.map(value=>({type:'text',value:String(value)})))],header:true,freeze_panes:'A2',auto_filter:true,column_widths:Object.fromEntries(c.columns.map((_,i)=>[String.fromCharCode(65+i),Math.min(80,Math.max(18,...[c.columns[i],...c.rows.map(row=>row.cells[i])].map(v=>Array.from(String(v)).reduce((n,char)=>n+(/[^\x00-\xff]/.test(char)?2:1),0)+3)))]))},
    ...(citations.length?[{name:'来源',rows:[['ID','文件','位置','摘录','数据行'],...citations.map(s=>[s.evidenceId,s.path,String(s.pageStart??s.lineStart??''),s.excerpt||'',c.rows.flatMap((row,i)=>row.evidenceIds?.includes(s.evidenceId)?[String(i+2)]:[]).join(', ')].map(value=>({type:'text',value:String(value)})))],header:true,freeze_panes:'A2',column_widths:{A:36,B:45,C:12,D:70,E:20}}]:[]),
  ]}
  if(artifact.kind==='slides')return {theme:artifact.parameters?.theme||'modern-clean',metadata:{title:artifact.title,author:'Knowledge Studio',language:artifact.parameters?.language||'zh-CN'},slides:c.slides.map(item=>{
    const {notes,...spec}=normalizeSlide(item)
    const references=(item.evidenceIds||[]).map(id=>citations.find(c=>c.evidenceId===id)).filter(Boolean)
    return {...spec,speaker_notes:notes+(references.length?'\n\n参考来源：\n'+references.map(ref=>ref.path+' · '+(ref.locator==='page'?'第 '+ref.pageStart+' 页':'第 '+ref.lineStart+' 行')+'\n'+(ref.excerpt||'')).join('\n'):'')}
  })}
  throw new Error(`Office skill specification unavailable for ${artifact.kind}`)
}
