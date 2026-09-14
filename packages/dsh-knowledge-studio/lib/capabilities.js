const LEGACY_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'briefing', title: '生成简报', description: '提炼目标、现状、重点和下一步。',
    interaction: 'none', execution: 'conversation', output: 'chat', available: true,
    prompt: '请基于当前工作区生成一份结构清晰的简报，覆盖目标、现状、关键发现、风险和下一步，并为重要判断提供可打开的工作区引用。',
  }),
  Object.freeze({
    id: 'faq', title: '生成 FAQ', description: '整理常见问题和证据充分的回答。',
    interaction: 'none', execution: 'conversation', output: 'chat', available: true,
    prompt: '请基于当前工作区整理一份 FAQ。优先覆盖新成员最可能遇到的问题，每个回答保持简洁，并为重要事实提供可打开的工作区引用。',
  }),
  Object.freeze({
    id: 'study-guide', title: '生成学习指南', description: '按由浅入深的顺序组织核心知识。',
    interaction: 'none', execution: 'conversation', output: 'chat', available: true,
    prompt: '请基于当前工作区生成一份学习指南，依次说明核心概念、推荐阅读顺序、实践任务和自测问题，并为重要内容提供可打开的工作区引用。',
  }),
  Object.freeze({
    id: 'quiz', title: '测验', description: '生成可答题、判分和追问的交互测验。',
    interaction: 'dialog', execution: 'artifact', output: 'interactive', rendererKey: 'quiz', available: true,
    parameters: [
      { id: 'count', label: '题目数量', type: 'select', default: 8, options: [{ value: 5, label: '少量 · 5 题' }, { value: 8, label: '标准 · 8 题' }, { value: 12, label: '较多 · 12 题' }] },
      { id: 'difficulty', label: '难度', type: 'select', default: 'medium', options: [{ value: 'easy', label: '基础' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '进阶' }] },
      { id: 'focus', label: '希望重点考什么？', type: 'textarea', default: '', placeholder: '留空则覆盖工作区最重要的内容' },
    ],
  }),
  Object.freeze({
    id: 'flashcards', title: '抽认卡', description: '生成可复习并记录进度的知识卡片。',
    interaction: 'dialog', execution: 'artifact', output: 'interactive', rendererKey: 'flashcards', available: true,
    parameters: [
      { id: 'count', label: '卡片数量', type: 'select', default: 15, options: [{ value: 8, label: '精简 · 8 张' }, { value: 15, label: '标准 · 15 张' }, { value: 24, label: '深入 · 24 张' }] },
      { id: 'focus', label: '希望重点复习什么？', type: 'textarea', default: '', placeholder: '留空则覆盖工作区最重要的内容' },
    ],
  }),
])

const focus = { id: 'focus', label: '主题与要求', type: 'textarea', default: '', placeholder: '受众、重点、希望回答的问题' }
const scope = { id: 'pathPrefix', label: '资料范围（可选）', type: 'text', default: '', placeholder: '工作区相对目录，例如 docs/' }
const format = (id, label, values) => ({ id, label, type: 'select', default: values[0][0], options: values.map(([value, label]) => ({ value, label })) })
const language = format('language','输出语言',[['zh-CN','简体中文'],['en','English'],['ja','日本語']])
const audience = {id:'audience',label:'面向谁？',type:'text',default:'',placeholder:'例如：新同事、学生、专业读者'}
const create = (id, title, description, parameters = [], output = 'document') => ({ id, title, description, interaction: 'dialog', execution: 'artifact', output, rendererKey: id, available: true, parameters: [...parameters, language, audience, focus, scope] })
const BUILTIN_CAPABILITIES = Object.freeze([
  create('report', '报告', '简报、学习指南与自定义 DOCX 报告。', [format('template', '报告类型', [['briefing','简报'],['faq','FAQ'],['study-guide','学习指南'],['custom','自定义']])]),
  create('mindmap', '思维导图', '浏览主题分支、查看来源，导出完整导图。', [format('detail','展开程度',[['auto','按材料决定'],['overview','简明概览'],['detailed','深入展开']])], 'interactive'),
  ...LEGACY_CAPABILITIES.filter(item => ['quiz','flashcards'].includes(item.id)).map(item => ({ ...item, title: item.id === 'flashcards' ? '闪卡' : item.title, parameters: [...item.parameters,...(item.id==='flashcards'?[format('difficulty','难度',[['medium','中等'],['easy','基础'],['hard','进阶']])]:[]), language, audience, scope] })),
  create('table', '数据表', '按字段抽取与比较，生成 XLSX 工作簿。', [{ id:'columns', label:'需要的列', type:'text', default:'', placeholder:'例如：主题、负责人、要求、时间' }]),
  create('slides', '演示文稿', '生成含讲稿的 PPTX 演示文稿。', [format('theme','视觉主题',[['modern-clean','简洁现代'],['academic-editorial','学术叙事'],['digital-tech','数字科技'],['warm-education','温暖教育']]),format('delivery','用途',[['presentation','演讲配合 · 简洁要点'],['reading','独立阅读 · 详细讲稿']]),format('count','页数',[[6,'6 页'],[10,'10 页'],[14,'14 页']])]),
  create('audio', '音频概览', '生成讲解或对谈音频与逐字稿。', [format('style','形式',[['narration','单人摘要'],['dialogue','双人深入探讨'],['critique','评论分析'],['debate','双方辩论']])], 'media'),
  create('video', '视频概览', '生成配音讲解视频与分镜脚本。', [format('count','场景数量',[[4,'4 个场景'],[6,'6 个场景'],[8,'8 个场景']])], 'media'),
])

function publicDescriptor(value) {
  const { prompt: _prompt, execute: _execute, ...descriptor } = value
  return structuredClone(descriptor)
}

function validateCapability(capability) {
  if (!capability || typeof capability !== 'object') throw new Error('Studio capability must be an object')
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(capability.id ?? ''))) throw new Error('Studio capability requires a stable lowercase id')
  if (!String(capability.title ?? '').trim()) throw new Error('Studio capability requires a title')
  if (!['none', 'inline', 'dialog'].includes(capability.interaction)) throw new Error(`Unsupported Studio interaction: ${capability.interaction}`)
  if (!['conversation', 'artifact', 'workflow'].includes(capability.execution)) throw new Error(`Unsupported Studio execution: ${capability.execution}`)
  if (!['chat', 'interactive', 'document', 'media'].includes(capability.output)) throw new Error(`Unsupported Studio output: ${capability.output}`)
  if (capability.parameters != null && !Array.isArray(capability.parameters)) throw new Error('Studio capability parameters must be an array')
}

export class StudioRegistry {
  #capabilities = new Map()

  constructor() {
    for (const capability of BUILTIN_CAPABILITIES) this.#capabilities.set(capability.id, capability)
  }

  register(capability, execute) {
    validateCapability(capability)
    if (this.#capabilities.has(capability.id)) throw new Error(`Studio capability is already registered: ${capability.id}`)
    const value = Object.freeze({ ...capability, execute })
    this.#capabilities.set(value.id, value)
    return () => { if (this.#capabilities.get(value.id) === value) this.#capabilities.delete(value.id) }
  }

  list() {
    return [...this.#capabilities.values()].map(publicDescriptor)
  }

  get(id) {
    return this.#capabilities.get(String(id)) ?? null
  }
}

export { BUILTIN_CAPABILITIES, validateCapability }

export function mediaParameters(kind, media) {
  const voiceWhen=kind==='video'?{narration:'on'}:{}
  const speech=media.speech.filter(p=>p.available&&p.voices.length)
  const defaultProvider=speech.find(p=>p.id==='system')?.id || speech[0]?.id || ''
  return [
    ...(kind==='video'?[format('aspect','画幅',[['16:9','横屏 · 16:9'],['9:16','竖屏 · 9:16'],['1:1','方形 · 1:1']]),format('narration','配音',speech.length?[['on','开启'],['off','关闭']]:[['off','不配音（当前没有可用音色）']]),{...format('sceneSeconds','无配音时每场景时长',[[6,'6 秒'],[10,'10 秒'],[15,'15 秒']]),when:{narration:'off'}}]:[]),
    {id:'provider',label:'语音服务',type:'select',default:defaultProvider,options:speech.map(p=>({value:p.id,label:p.title+(p.local?' · 本地':'')})),when:voiceWhen},
    {id:'voice',label:'音色 A',type:'select',default:'',options:[{value:'',label:'自动选择'},...speech.flatMap(p=>p.voices.map(v=>({value:v.id,label:`${v.title} · ${v.language || ''}`,when:{provider:p.id}})))],when:voiceWhen},
    ...(kind==='audio'?[{id:'voiceB',label:'音色 B',type:'select',default:'',options:[{value:'',label:'与音色 A 相同'},...speech.flatMap(p=>p.voices.map(v=>({value:v.id,label:v.title,when:{provider:p.id}})))],whenNot:{style:'narration'}}]:[]),
    {...format('speed','语速',[[1,'正常'],[.8,'稍慢'],[1.2,'稍快']]),when:voiceWhen},
    {...format('subtitles',kind==='video'?'字幕与字幕文件':'导出字幕文件',[['on','开启'],['off','关闭']]),when:voiceWhen},
    {id:'bgm',label:'背景音乐',type:'select',default:'',options:[{value:'',label:'关闭'},...media.music.map(t=>({value:t.id,label:t.title}))]},
    {...format('bgmVolume','背景音乐音量',[[.16,'轻柔'],[.3,'适中'],[.5,'明显']]),whenNonempty:'bgm'},
  ]
}
