import React, {useEffect, useState} from 'react'
const h = React.createElement
export const settingsZh = {
  remove: '移除',
  connections: '外部智能体',
  discoveryNote: '只扫描本机安装位置；不会自动安装、登录或启动智能体。',
  refresh: '重新扫描',
  check: '检测连接',
  enable: '启用',
  disable: '停用',
  enabled: '已启用',
  disabled: '未启用',
  add: '添加 ACP',
  agentName: '名称',
  command: '可执行文件绝对路径',
  args: '参数（JSON 数组）',
  activation_failed: '恢复连接失败，请停用后重新检测启用；检查是否已注册同名 provider。',
  cleanup_failed: '进程清理失败，连接未通过检测',
  unchecked: '尚未检测',
  connected: '本机登录可用',
  handshake: 'ACP 握手成功；登录及真实任务尚未验证',
  unavailable: '不可用，请检查安装或登录',
  timeout: '连接超时',
  invalid_response: '不是有效的 ACP 响应',
  missing_cli: '未找到 Agent CLI',
  installedApp: '已发现应用，尚无 Agent CLI',
  notFound: '未发现本机 CLI',
  bundledRuntime: 'DSH 官方 Codex 运行时',
  codexNote: '使用 DSH 官方 Codex 运行时，复用本机登录。',
  acpNote: '通过 stdio 连接；权限请求默认拒绝。请先在该智能体中完成登录。',
  disableNote: '停用阻止新任务；已开始的任务继续由 DSH 管理。',
  addingNote: '保存不会启动程序。仅添加你信任的本机程序，不在参数中填写密钥。',
  failed: '操作失败，请检查配置后重试。',
  invalidArgs: '参数必须是字符串组成的 JSON 数组。'
}
export const settingsEn = {
  remove: 'Remove',
  connections: 'External agents',
  discoveryNote: 'Scan local installation paths only. No automatic installation, login or agent startup.',
  refresh: 'Rescan',
  check: 'Check connection',
  enable: 'Enable',
  disable: 'Disable',
  enabled: 'Enabled',
  disabled: 'Disabled',
  add: 'Add ACP',
  agentName: 'Name',
  command: 'Absolute executable path',
  args: 'Arguments (JSON array)',
  activation_failed: 'Could not restore connection. Disable and recheck; check for a duplicate provider.',
  cleanup_failed: 'Process cleanup failed; connection check did not pass',
  unchecked: 'Not checked',
  connected: 'Local login available',
  handshake: 'ACP handshake passed; login and real tasks not yet verified',
  unavailable: 'Unavailable; check installation or login',
  timeout: 'Connection timed out',
  invalid_response: 'Invalid ACP response',
  missing_cli: 'Agent CLI not found',
  installedApp: 'App found; Agent CLI missing',
  notFound: 'Local CLI not found',
  bundledRuntime: 'Official DSH Codex runtime',
  codexNote: 'Uses the official DSH Codex runtime and existing local login.',
  acpNote: 'Connects over stdio; permission requests are rejected by default. Log in through the agent first.',
  disableNote: 'Disabling blocks new tasks. DSH continues to manage existing runs.',
  addingNote: 'Saving does not start the program. Add only trusted local executables; do not put secrets in arguments.',
  failed: 'Operation failed. Check the configuration and retry.',
  invalidArgs: 'Arguments must be a JSON array of strings.'
}
export function Settings({manage, t}) {
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [command, setCommand] = useState(''), [args, setArgs] = useState('[]')
  const run = async request => {
    setBusy(true); setError('')
    try { setRows((await manage(request)).rows); return true }
    catch { setError(t('failed')); return false }
    finally { setBusy(false) }
  }
  useEffect(() => { void run({op: 'list'}) }, [manage])
  const button = (label, onClick, disabled = false) => h('button', {className: 'eduwork-agent-trigger', type: 'button', onClick, disabled: busy || disabled}, label)
  const field = (label, value, onChange, placeholder) => h('label', null, h('span', null, t(label)), h('input', {value, placeholder, onChange: e => onChange(e.target.value), disabled: busy, autoComplete: 'off'}))
  return h('section', {className: 'eduwork-agent-settings'},
    h('h2', null, t('connections')), h('p', null, t('discoveryNote')),
    h('div', {className: 'eduwork-agent-actions'}, button(t('refresh'), () => run({op: 'list'})), button(t('add'), () => setAdding(!adding))),
    error && h('p', {role: 'alert'}, error),
    ...rows.map(row => h('article', {key: row.id},
      h('header', null, h('strong', null, row.name), h('span', null, t(row.enabled ? 'enabled' : 'disabled'))),
      h('p', null, t(row.kind === 'codex' ? 'codexNote' : 'acpNote')),
      h('code', null, row.command || t(row.kind === 'codex' ? 'bundledRuntime' : row.installed ? 'installedApp' : 'notFound')),
      row.args.length > 0 && h('code', null, JSON.stringify(row.args)),
      h('p', {role: 'status'}, t(row.message)),
      h('div', {className: 'eduwork-agent-actions'}, button(t('check'), () => run({op: 'check', id: row.id}), row.kind !== 'codex' && !row.command), button(t(row.enabled ? 'disable' : 'enable'), () => run({op: 'enable', id: row.id, enabled: !row.enabled}), !row.enabled && !row.checked), row.id.startsWith('acp_') && button(t('remove'), () => run({op: 'remove', id: row.id}), row.enabled)))),
    h('p', null, t('disableNote')),
    adding && h('form', {onSubmit: async e => {
      e.preventDefault(); let parsed
      try { parsed = JSON.parse(args); if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) throw Error() } catch { setError(t('invalidArgs')); return }
      if (await run({op: 'add', name: name.trim(), command: command.trim(), args: parsed})) {setAdding(false); setName(''); setCommand(''); setArgs('[]')}
    }}, h('h3', null, t('add')), h('p', null, t('addingNote')), field('agentName', name, setName), field('command', command, setCommand, '/absolute/path/to/agent'), field('args', args, setArgs, '["acp"]'), h('button', {className: 'eduwork-agent-trigger', type: 'submit', disabled: busy || !name.trim() || !command.trim()}, t('add'))))
}
export const settingsCss = `.eduwork-agent-trigger{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l4,#ddd);border-radius:8px;padding:5px 9px;background:transparent;color:inherit;cursor:pointer}.eduwork-agent-settings{max-width:720px;padding:8px 4px;color:inherit;font-size:13px}.eduwork-agent-settings p{color:var(--dsw-alias-label-secondary,#777);line-height:1.6}.eduwork-agent-settings article{border:1px solid var(--dsw-alias-border-l4,#ddd);border-radius:10px;padding:16px;margin:14px 0}.eduwork-agent-settings header,.eduwork-agent-actions{display:flex;align-items:center;gap:10px}.eduwork-agent-settings header{justify-content:space-between}.eduwork-agent-settings header span{font-size:12px}.eduwork-agent-settings code{display:block;font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}.eduwork-agent-settings form{border-top:1px solid var(--dsw-alias-border-l4,#ddd);margin-top:20px;padding-top:12px}.eduwork-agent-settings label{display:grid;gap:6px;margin:12px 0}.eduwork-agent-settings input{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l4,#ddd);border-radius:7px;padding:9px}.eduwork-agent-settings button:disabled{opacity:.45;cursor:default}`
