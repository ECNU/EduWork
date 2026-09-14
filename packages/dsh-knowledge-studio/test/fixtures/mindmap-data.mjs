// Entirely synthetic public materials; unrelated to any user's workspace.
export function mindmapFixture({id='synthetic-mindmap',workspaceId='synthetic-workspace',sessionId='studio-toolbar-fixture',legacy=false}={}) {
  const node=(id,parentId,label,body='此节点的说明来自合成资料，用于验证知识结构与可核验来源。')=>({id,parentId,label,body,evidenceIds:['file_synthetic_reference']})
  const nodes=legacy?[node('root','','公共服务合成概览'),...Array.from({length:6},(_,i)=>node('legacy-'+i,'root','主题分支'+(i+1),'旧版合成成果保存了较长的说明文字，原有父子关系和来源应直接保留。'.repeat(3)))]:[
    node('root','','城市公共服务知识框架'),
    node('services','root','服务设计'),node('access','services','服务渠道'),node('online','access','线上办理'),node('inclusive','online','面向不同使用者的中文长标签说明与无障碍访问支持'),
    node('offline','access','线下窗口'),node('feedback','services','公众反馈'),node('survey','feedback','需求调研'),
    node('operations','root','运营协作'),node('workflow','operations','职责分工'),node('training','workflow','培训与交接'),node('review','operations','持续改进'),
    node('information','root','信息管理'),node('catalog','information','资料目录'),node('quality','information','质量检查'),node('trace','quality','来源核验'),node('history','trace','版本记录'),
  ]
  return {id,workspaceId,workspaceTitle:'合成工作区',sessionId,kind:'mindmap',title:legacy?'旧版合成导图':'城市公共服务知识框架',parameters:legacy?{count:6,template:'briefing',style:'narration'}:{detail:'auto'},status:'completed',phase:'done',version:1,createdAt:'2026-09-07T06:00:00.000Z',updatedAt:'2026-09-07T06:00:00.000Z',sourceScope:'本地合成材料',exports:[],interaction:{},content:{title:'城市公共服务知识框架',nodes},citations:[{evidenceId:'file_synthetic_reference',path:'synthetic-notes.md',locator:'line',lineStart:1,lineEnd:4,excerpt:'合成资料：公共服务包括服务设计、运营协作和信息管理。服务渠道需兼顾线上与线下，并保持可核验的版本记录。',fresh:true}]}
}
