import {mindmapMarkdown} from './mindmap.js'
import {normalizeSlide,SLIDE_CONTENT_SCHEMA,slideOutline} from './studio-slides.js'
const text = (value, max = 4000, label='成果文本') => {
  if(value!=null&&typeof value==='object')throw new Error(`${label}必须是文本`)
  const result=String(value??'').trim()
  if(result.length>max)throw new Error(`${label}超过 ${max} 字符，请拆成更清晰的小节；原始草稿已保留。`)
  return result
}
function list(value,max,label) {
  if(!Array.isArray(value))throw new Error(`${label}必须是列表`)
  if(value.length>max)throw new Error(`${label}超过 ${max} 项，未截断保存；可从草稿重新组织。`)
  return value
}
export const CONTENT_SCHEMAS = {
  report: '{"title":"标题","sections":[{"heading":"小节","body":"Markdown 正文","evidenceIds":["S1"]}]}',
  mindmap: '{"title":"标题","nodes":[{"id":"n1","parentId":"","label":"中心主题","body":"解释","evidenceIds":["S1"]},{"id":"n2","parentId":"n1","label":"子概念","body":"解释","evidenceIds":["S1"]}]}',
  table: '{"title":"标题","columns":["字段1","字段2"],"rows":[{"cells":["值1","值2"],"evidenceIds":["S1"]}]}',
  slides: SLIDE_CONTENT_SCHEMA,
  audio: '{"title":"标题","segments":[{"speaker":"A","text":"讲解内容","evidenceIds":["S1"]},{"speaker":"B","text":"问题或补充","evidenceIds":["S1"]}]}',
  video: '{"title":"标题","scenes":[{"heading":"一句结论","bullets":["简短要点"],"narration":"配音稿","evidenceIds":["S1"]}]}',
}
export function contentItems(content) {
  return content?.questions ?? content?.cards ?? content?.sections ?? content?.nodes ?? content?.rows ?? content?.slides ?? content?.segments ?? content?.scenes ?? []
}
export function validateContent(kind, raw, evidence) {
  const source = text(raw, 2_000_000,'成果 JSON').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(source)
  const allowed = new Set(evidence.map(item => item.evidenceId))
  const key = { report:'sections', mindmap:'nodes', table:'rows', slides:'slides', audio:'segments', video:'scenes' }[kind]
  if (!key || !Array.isArray(parsed[key]) || !parsed[key].length) throw new Error('模型未返回有效成果内容')
  const columns = kind === 'table' ? list(parsed.columns??[],26,'数据表字段').map(value => text(value, 200,'字段名称')) : undefined
  if (kind === 'table' && !columns?.length) throw new Error('数据表缺少字段')
  const items = list(parsed[key],kind==='slides'?40:kind==='mindmap'?300:kind==='table'?1000:200,'成果条目').map((item, index) => {
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`第 ${index+1} 项必须是对象`)
    const evidenceIds = [...new Set((Array.isArray(item.evidenceIds)?item.evidenceIds:[]).filter(id=>allowed.has(id)))]
    const common = { id: kind === 'mindmap' ? text(item.id, 60) : `item${index + 1}`, evidenceIds }
    if (kind === 'table') {
      if (!Array.isArray(item.cells) || item.cells.length > columns.length) throw new Error('数据表行与字段数量不一致')
      return { ...common, cells: columns.map((_,index) => text(item.cells[index], 32000,'单元格')) }
    }
    if (kind === 'report') return { ...common, heading:text(item.heading, 300,'小节标题'), body:text(item.body, 100000,'小节正文') }
    if (kind === 'mindmap') return { ...common, parentId:text(item.parentId,60), label:text(item.label,100), body:text(item.body) }
    if (kind === 'audio') return { ...common, speaker:item.speaker === 'B' ? 'B' : 'A', text:text(item.text, 1800) }
    if (kind === 'slides') return {...normalizeSlide(item),...common}
    return { ...common, heading:text(item.heading,80), bullets:list(item.bullets??[],6,'屏显要点').map(value => text(value,300,'要点')), notes:text(item.notes,50000,'讲稿'), narration:text(item.narration,12000,'旁白') }
  })
  if (items.some(item => !String(item.body || item.text || item.label || item.heading || item.title || item.quote || item.cells?.join('') || (kind==='slides'?slideOutline(item).join(''):item.narration||item.bullets?.join('')) || '').trim())) throw new Error('成果存在空白内容')
  if (kind === 'mindmap') {
    const ids = new Set(items.map(item => item.id))
    if (ids.size !== items.length || ids.has('')) throw new Error('思维导图节点标识无效')
    for (const item of items) {
      const seen = new Set([item.id]); let parent = item.parentId
      while (parent) {
        if (!ids.has(parent) || seen.has(parent)) throw new Error('思维导图存在循环或未知父节点')
        seen.add(parent); parent = items.find(node => node.id === parent).parentId
      }
    }
  }
  return { title:text(parsed.title,150) || 'Studio 成果', ...(columns ? { columns } : {}), [key]:items }
}

export function contentMarkdown(artifact) {
  if(artifact.kind==='mindmap')return mindmapMarkdown(artifact)
  const content = artifact.content
  const cite = item => (item.evidenceIds ?? []).map(id => {
    const source = artifact.citations?.find(c => c.evidenceId === id)
    return source ? `${source.path} (${source.locator === 'page' ? 'P'+source.pageStart : 'L'+source.lineStart})` : ''
  }).filter(Boolean).join('；')
  if(artifact.kind==='table') {
    const cell=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ')
    const hasSources=content.rows.some(row=>cite(row)),columns=[...content.columns,...(hasSources?['来源']:[])]
    return `# ${artifact.title}\n\n| ${columns.map(cell).join(' | ')} |\n| ${columns.map(()=> '---').join(' | ')} |\n`+content.rows.map(row=>`| ${[...row.cells,...(hasSources?[cite(row)]:[])].map(cell).join(' | ')} |`).join('\n')
  }
  return `# ${artifact.title}\n\n` + contentItems(content).map(item => {
    const body = item.question ? `${item.options.map((option,index)=>String.fromCharCode(65+index)+'. '+option).join('\n')}\n\n答案：${String.fromCharCode(65+item.correctIndex)}\n${item.explanation}` : item.body || item.text || item.narration || item.back || item.explanation || item.cells?.join(' | ') || item.notes || ''
    const outline=artifact.kind==='slides'?slideOutline(item):item.bullets
    const heading=item.title || item.heading || item.label || item.question || item.front || item.speaker,reference=cite(item)
    return `${heading?'## '+heading+'\n\n':''}${outline?.map(b => '- '+b).join('\n') ?? ''}\n${body}${reference?'\n\n来源：'+reference:''}`
  }).join('\n\n')
}
