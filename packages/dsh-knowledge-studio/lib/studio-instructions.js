/** Human-readable Studio request; only options relevant to this capability. */
export function artifactRequest(capability,parameters={}) {
  const canonical=value=>value===true?'on':value===false?'off':String(value)
  const matches=condition=>Object.entries(condition||{}).every(([key,value])=>canonical(parameters[key])===canonical(value))
  const lines=[]
  for(const parameter of capability.parameters||[]) {
    const value=parameters[parameter.id]
    if(value==null||value===''||(parameter.when&&!matches(parameter.when))||(parameter.whenNot&&matches(parameter.whenNot)))continue
    const option=parameter.options?.find(option=>canonical(option.value)===canonical(value)&&(!option.when||matches(option.when)))
    lines.push(`${parameter.label}：${option?.label||String(value)}`)
  }
  return `请基于当前工作区生成${capability.title}，并将成果保存在 Studio。${lines.length?'\n\n'+lines.join('\n'):''}\n\n按 knowledge-studio 技能创建并登记成果，完成后确认其出现在 Studio 最近成果中。保留可核验的资料来源。资料不足时请明确说明。直接使用工作区原始资料。`
}

export function studioInstructions(kind,parameters={}) {
  switch(kind) {
    case 'mindmap':return `生成围绕一个中心主题的思维导图。先归纳主题，再用平行分类组织一级分支，把细节放入相应子节点。根据材料形成${parameters.detail==='overview'?'2～3':parameters.detail==='detailed'?'3～4':'2～4'}层；资料少可更浅，不硬凑节点数。标签使用简练的名词或短语（中文尽量4～12字），详细解释写入 body，不能把整段说明当作标签或只有根节点加大段一级项。仅一个根节点，其 parentId 为空；其他节点的 parentId 指向真实父节点。有对应来源时填写 evidenceIds；没有就省略。`
    case 'report':return `生成${{briefing:'简报',faq:'问答报告','study-guide':'学习指南',custom:'自定义报告'}[parameters.template]||'报告'}。sections.body 使用 Markdown。`
    case 'table':return `生成资料整理表。${parameters.columns?'需要的列：'+parameters.columns+'。':''}当前 cells 为原始文本，不支持计算公式；需要计算型工作簿时使用 office_spreadsheet。`
    case 'slides':return `生成 ${parameters.count||6} 页演示文稿，主题为 ${parameters.theme||'modern-clean'}，用途为${parameters.delivery==='reading'?'独立阅读':'现场讲述'}。使用共享语义字段，完整讲者备注写入 notes。输出格式中的版式是示例，不要求照搬页数与次序。`
    case 'audio':return `生成${{narration:'单人讲解',dialogue:'双人深入探讨',critique:'评论分析',debate:'双方辩论'}[parameters.style]||'讲解'}，讲述者字段使用 A 或 B。`
    case 'video':return `生成 ${parameters.count||6} 个场景的视频分镜。配音：${parameters.narration===false||parameters.narration==='off'?'关闭':'开启'}。scenes 使用 heading、bullets 和 narration 字段。`
    default:throw new Error('Unknown Studio content kind')
  }
}
