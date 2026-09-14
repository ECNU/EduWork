// Studio adds provenance and notes to the shared Office semantic slide spec.
// Rendering and final layout validation remain in artifact-services.
import {PRESENTATION_METRICS,validateMetricValue} from '@eduwork/dsh-artifact-services/presentation-contract'
const fields = {
  cover:['title','subtitle','meta'], section:['number','title','subtitle'],
  summary:['title','bullets'], bullets:['title','kicker','bullets','note'],
  'two-column':['title','left','right'], metrics:['title','metrics'],
  timeline:['title','events'], 'feature-grid':['title','items'], roadmap:['title','stages'],
  quote:['quote','attribution'], closing:['title','subtitle','contact'],
}
export const SLIDE_CONTENT_SCHEMA = JSON.stringify({title:'演示标题',slides:[
  {layout:'cover',title:'封面标题',subtitle:'简短副标题',notes:'完整讲稿',evidenceIds:['S1']},
  {layout:'two-column',title:'两方面比较',left:{heading:'方面一',bullets:['要点']},right:{heading:'方面二',bullets:['要点']},notes:'讲稿',evidenceIds:['S1']},
  {layout:'metrics',title:'关键指标',metrics:[{value:'真实数值',label:'指标名',detail:'口径'},{value:'真实数值',label:'指标名',detail:'口径'}],notes:'讲稿',evidenceIds:['S1']},
  {layout:'timeline',title:'演进过程',events:[{period:'时间',title:'事件',detail:'说明'},{period:'时间',title:'事件',detail:'说明'},{period:'时间',title:'事件',detail:'说明'}],notes:'讲稿',evidenceIds:['S1']},
  {layout:'feature-grid',title:'主题组成',items:[{title:'主题一',detail:'说明'},{title:'主题二',detail:'说明'},{title:'主题三',detail:'说明'}],notes:'讲稿',evidenceIds:['S1']},
  {layout:'roadmap',title:'实施步骤',stages:[{stage:'阶段一',title:'行动',detail:'结果'},{stage:'阶段二',title:'行动',detail:'结果'},{stage:'阶段三',title:'行动',detail:'结果'}],notes:'讲稿',evidenceIds:['S1']},
  {layout:'bullets',title:'核心结论',bullets:['简短要点'],notes:'讲稿',evidenceIds:['S1']},
  {layout:'closing',title:'下一步',subtitle:'核心行动',notes:'讲稿',evidenceIds:['S1']},
]})

function safeValue(value,depth=0) {
  if(depth>5)throw new Error('演示内容嵌套过深')
  if(typeof value==='string') {if(value.length>100000)throw new Error('演示文本超过 100000 字符，草稿已保留');return value}
  if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value
  if(Array.isArray(value)){if(value.length>1000)throw new Error('演示单组输入超过 1000 项的资源限制；草稿已保留');return value.map(v=>safeValue(v,depth+1))}
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!=null).map(([k,v])=>[k,safeValue(v,depth+1)]))
  throw new Error('演示规格包含不支持的空值或字段类型')
}
export function normalizeSlide(item) {
  const layout=item.layout??'summary',allowed=fields[layout]
  if(!allowed)throw new Error(`不支持的演示版式：${layout}`)
  const spec={layout}
  for(const key of allowed)if(item[key]!=null)spec[key]=safeValue(item[key])
  if(layout==='metrics') {
    if(!Array.isArray(spec.metrics)||!spec.metrics.length)throw new Error('指标页面需要至少一项指标')
    for(const metric of spec.metrics)validateMetricValue(metric?.value)
  }
  if(layout!=='quote'&&!spec.title&&item.heading)spec.title=safeValue(item.heading)
  if(spec.title!=null&&typeof spec.title!=='string'||spec.quote!=null&&typeof spec.quote!=='string')throw new Error('演示标题或引语必须是文本')
  const notes=[item.notes,item.speaker_notes].filter(Boolean)
  if(notes.some(value=>typeof value!=='string')||notes.join('\n\n').length>90000)throw new Error('讲稿必须是文本且不超过 90000 字符，草稿已保留')
  return {...spec,notes:notes.join('\n\n')}
}

/** Text-only companion to the file preview, preserving semantic fields. */
export function slideOutline(slide) {
  const bullet=value=>typeof value==='string'?value:value.text
  return [slide.subtitle,slide.meta,slide.kicker,
    ...(slide.bullets||[]).map(bullet),
    ...[slide.left,slide.right].filter(Boolean).map(column=>[column.heading,...(column.bullets||[]).map(bullet)].join('：')),
    ...(slide.metrics||[]).map(metric=>[metric.value,metric.label,metric.detail].filter(Boolean).join(' · ')),
    ...(slide.events||[]).map(event=>[event.period,event.title,event.detail].filter(Boolean).join(' · ')),
    ...(slide.items||[]).map(item=>[item.title,item.detail].filter(Boolean).join('：')),
    ...(slide.stages||[]).map(stage=>[stage.stage,stage.title,stage.detail].filter(Boolean).join(' · ')),
    slide.quote,slide.attribution,slide.note,slide.contact,
  ].filter(Boolean)
}
