// Search public navigation metadata only. Never index configuration values,
// account names, secrets, or mount inactive settings pages to collect text.
const aliases = [
  [/general|通用|常规/i, 'language 语言 启动 startup 关闭 窗口 window'],
  [/model|模型/i, 'api key API密钥 接口 地址 base url provider 提供方 推理 reasoning token'],
  [/personalization|appearance|个性|外观/i, 'theme 主题 配色 字体 font 深色 dark 浅色 light'],
  [/preset|预设/i, 'agent 智能体 工具 权限 prompt 提示词'],
  [/plugin|extension|插件|扩展/i, 'install 安装 卸载 启用 禁用 MCP'],
  [/password|密码/i, 'password 密码 账号 自动填写 autofill 保存 登录 login Agent 智能体 内建 浏览器 授权'],
  [/shortcut|快捷/i, 'keyboard 键盘 快捷键 热键 hotkey'],
  [/web.search|搜索/i, 'search 搜索 引擎 engine 联网'],
  [/about|关于/i, 'version 版本 更新 update'],
  [/archive|归档/i, '会话 session 删除 恢复'],
  [/notification|通知/i, '消息 提醒 声音 sound'],
  [/mail|邮件/i, '邮箱 email 邮件 smtp imap'],
  [/pet|宠物/i, '桌宠 桌面 动画'],
]
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim()
export function searchSettings(rows, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return rows.map(row => {
    const name = normalize(row.label), id = normalize(row.id)
    const keywords = aliases.filter(([pattern]) => pattern.test(id + ' ' + name)).map(([, words]) => words).join(' ')
    const haystack = normalize(`${name} ${id} ${keywords}`)
    return { ...row, score: terms.every(term => haystack.includes(term)) ? (terms.every(term => name.includes(term)) ? 2 : 1) : 0 }
  }).filter(row => row.score).sort((a,b) => b.score - a.score || (a.order ?? 0) - (b.order ?? 0))
}
