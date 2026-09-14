import { canonicalSkillName, effectiveDisabledSkills, skillToggleSettings } from '@chatecnu-work/dsh-skill-settings-native/policy'
export { canonicalSkillName, effectiveDisabledSkills, skillToggleSettings }
export const bundledSkillCatalog = Object.freeze([
  Object.freeze({ name: 'artifact-documents', group: 'create', label: 'Word 文档', description: '撰写和编辑报告、方案、通知等 Word 文档。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-pdfs', group: 'research', label: 'PDF 处理', description: '读取 PDF、合并文件、抽取页面，也可制作简单 PDF。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-presentations', group: 'create', label: 'PPT 演示文稿', description: '组织讲述思路，选择主题和版式，制作 PPTX。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-spreadsheets', group: 'create', label: 'Excel 表格', description: '整理数据、设置公式和格式，创建或编辑 XLSX。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-images', group: 'create', label: '图像创作', description: '生成插图、海报与封面，并适配所需尺寸。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-speech', group: 'create', label: '语音与转写', description: '生成朗读、旁白和音频，或将已有录音转写成文字。', requiresEnterprise: false }),
  Object.freeze({ name: 'artifact-video', group: 'create', label: '视频创作', description: '设计分镜、画面和动画，结合配音与字幕制作视频。', requiresEnterprise: false }),
  Object.freeze({ name: 'knowledge-studio', group: 'organize', label: 'Studio 成果管理', description: '在 Studio 保存成果、归并同轮修改，查看和下载最终版本。', requiresEnterprise: false }),
  Object.freeze({ name: 'browser', group: 'research', label: '网页搜索与浏览', description: '查找互联网公开资料、阅读网页并操作网站。', requiresEnterprise: false }),
  Object.freeze({ name: 'skill-creator', group: 'assist', label: '技能创作', description: '将重复工作整理成可复用技能，创建或修改技能说明。', requiresEnterprise: false }),
  Object.freeze({ name: 'ecnu-campus-search', group: 'research', label: '华师大校内搜索', description: '查找华师大办事入口、政策、机构、人员和校园资讯。', requiresEnterprise: true }),
  Object.freeze({ name: 'eduwork-help', group: 'assist', label: '产品使用帮助', description: '解答 EduWork 的安装、配置、使用和故障排查问题。', requiresEnterprise: false }),
  Object.freeze({ name: 'ui-ux-pro-max', group: 'assist', label: '界面设计顾问', description: '设计和改进网页、应用的布局与交互；默认关闭。', requiresEnterprise: false }),
])

export const skillGroups = Object.freeze([
  { id: 'create', label: '内容创作' },
  { id: 'research', label: '搜索与资料' },
  { id: 'organize', label: '成果管理' },
  { id: 'assist', label: '辅助工具' },
  { id: 'custom', label: '个人与项目技能' },
])


export function skillCenterRows(catalog=[],settings={}){
 const disabled=effectiveDisabledSkills(settings),labels=new Map(bundledSkillCatalog.map(row=>[row.name,row])),rows=new Map()
 for(const item of [...catalog].sort((a,b)=>(a.source==='builtin'?-1:1)-(b.source==='builtin'?-1:1))){
  const name=canonicalSkillName(item.name), existing=rows.get(name)
  if(existing){if(item.source==='personal')existing.variants.push({...item,legacy:item.name!==name});continue}
  const label=labels.get(name)
  rows.set(name,{...item,name,label:label?.label||name,description:label?.description||item.description,group:label?.group||'custom',enabled:!disabled.has(name),available:item.available!==false,variants:[]})
 }
 return [...rows.values()]
}
