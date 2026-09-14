import {validateContent} from '../../lib/studio-content.js'

export function slidesFixture({workspaceId='synthetic-workspace',sessionId='studio-toolbar-fixture'}={}) {
  const citation={evidenceId:'synthetic-slide-source',path:'synthetic-notes.md',locator:'line',lineStart:1,lineEnd:1,excerpt:'合成资料：便民服务试点覆盖三个渠道，分三阶段推进；共设四个服务入口、两轮复核。所有数据仅供软件验收。'}
  const notes='这是一份合成演示文稿，用于检验多种语义版式、讲稿保留与来源追溯。所有数值只用于软件验收，不代表实际业务结果。'
  const slides=[
    {layout:'cover',title:'让公共服务更易使用',subtitle:'合成试点方案 · 内容与文件一致性验收',meta:'软件验收材料'},
    {layout:'two-column',title:'同时改善入口和协作',left:{heading:'服务使用者',bullets:['入口容易找到','办理进度清晰']},right:{heading:'服务提供者',bullets:['职责边界明确','问题可以追溯']}},
    {layout:'feature-grid',title:'三个渠道承接不同需求',items:[{title:'线上办理',detail:'提供操作指引与材料清单'},{title:'线下窗口',detail:'保留现场辅助和咨询支持'},{title:'意见反馈',detail:'收集问题并回到改进环节'}]},
    {layout:'metrics',title:'试点规模保持可验证',metrics:[{value:'4',label:'服务入口',detail:'合成验收口径'},{value:'2',label:'复核轮次',detail:'每轮保留记录'}]},
    {layout:'timeline',title:'先理解需求再验证效果',events:[{period:'第一阶段',title:'整理需求',detail:'形成材料清单'},{period:'第二阶段',title:'小范围试点',detail:'记录反馈与问题'},{period:'第三阶段',title:'复核效果',detail:'判断是否扩大范围'}]},
    {layout:'roadmap',title:'把发现落实为持续改进',stages:[{stage:'近期',title:'明确责任',detail:'确定入口与负责人'},{stage:'中期',title:'补充记录',detail:'追踪修改过程'},{stage:'持续',title:'复核体验',detail:'更新使用指引'}]},
    {layout:'bullets',title:'每次修改都可追溯',bullets:['记录修改依据','保留复核结果','同步更新说明']},
    {layout:'closing',title:'从一个可验证的试点开始',subtitle:'收集反馈，形成下一轮改进计划'},
  ].map((slide,index)=>({...slide,notes:`第 ${index+1} 页讲稿。${notes.repeat(4)}`,evidenceIds:[citation.evidenceId]}))
  return {id:'synthetic-slides',workspaceId,sessionId,kind:'slides',title:'合成多版式演示文稿',status:'completed',phase:'done',parameters:{theme:'digital-tech',count:8,language:'zh-CN',delivery:'reading'},content:validateContent('slides',JSON.stringify({title:'合成多版式演示文稿',slides}),[citation]),citations:[citation],sourceScope:'仅使用合成资料',exports:[],createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'}
}

export function draftFixture({workspaceId,sessionId}) {
  return {id:'synthetic-report-draft',workspaceId,sessionId,kind:'report',title:'合成未完成报告',status:'failed',phase:'done',parameters:{},message:'输出达到长度上限；草稿已保留。',draft:{text:'{"title":"合成未完成报告","sections":['+'草稿正文。'.repeat(3000),format:'json',reason:'output-limit'},citations:[],exports:[],generation:{provider:'synthetic',model:'fixture',maxTokens:65536,budgetSource:'model-default',finishKind:'max-tokens'},createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'}
}
