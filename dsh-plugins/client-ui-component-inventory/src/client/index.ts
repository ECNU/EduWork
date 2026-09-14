import React, { useEffect, useState } from 'react'
import componentInventoryRemote from '@chatecnu-work/dsh-component-inventory-native/remote'
import pluginManagerRemote from '@chatecnu-work/dsh-plugin-manager-native/remote'

export const inject = ['slots', 'locale', 'remote']
const h = React.createElement

const copy = {
  zh: {
    tab: '组件与版本', title: '组件与版本', subtitle: '查看产品平台、代码运行时和能力环境。插件清单与挂载状态由 DSH 官方页面提供。',
    platform: '产品与平台', platformHint: '承载本机 Agent Core 和渲染界面。',
    runtimeGroup: '代码运行时', runtimeHint: '执行 DSH、插件、Skills 及办公脚本的语言运行环境。',
    capability: '能力环境', capabilityHint: '由插件或 Skills 按需使用的共享依赖环境。',
    loading: '正在读取组件…', failure: '暂时无法读取组件信息。', retry: '重试', unknown: '未声明',
    configuration: '配置状态',
    sourceMode: '源码 / Web', desktopMode: '绿色发行包', core: 'DSH Core', productName: '产品', runtime: '运行环境', commit: '提交',
    ready: '已就绪', available: '已随包提供', 'not-initialized': '尚未初始化', missing: '缺失', unavailable: '不可用',
    'release-bundled': '发行包内置', 'managed-data': '产品托管', 'offline-seed': '离线资源', 'network-managed': '按需准备', source: '源码环境', system: '系统环境',
    dependsOn: '依赖', usedBy: '使用方', componentPath: '位置', lockedVersion: '锁定版本', packageFlavor: '交付形态', online: '在线包', offline: '离线包', development: '开发构建',
    'desktop-shell': '桌面容器', 'dsh-core': 'DSH Core', webview2: '界面渲染', nodejs: 'Node.js', python: 'Python',
    'office-suite': '办公文档环境', 'browser-automation': '浏览器自动化', 'video-production': '视频制作环境', chromium: '共享 Chromium',
    'desktop-ui': '桌面界面', 'agent-loop': 'Agent Loop', documents: '文档 Skill', pdfs: 'PDF Skill', presentations: '演示文稿 Skill', spreadsheets: '表格 Skill',
    'browser-plugin': '浏览器插件', 'browser-skill': '浏览器 Skill', 'web-search': '联网搜索', 'video-creation': '视频制作 Skill',
    'desktop-shell-desc': '当前桌面壳提供窗口、托盘、更新及系统能力。', 'dsh-core-desc': 'Agent Core、会话与插件组合。', 'webview2-desc': '桌面界面的私有 WebView2 渲染引擎。',
    'nodejs-desc': '执行 DSH Core、插件及 Node 工具。', 'python-desc': '执行办公文档和数据处理脚本。',
    'office-suite-desc': '文档、表格、演示文稿和 PDF 共用的 Python 环境。', 'browser-automation-desc': '浏览器插件、网页搜索和页面操作共用的 Playwright + Chromium。',
    'video-production-desc': 'Remotion 与 FFmpeg 视频生成、混音及编码环境。',
    'chromium-desc': '用于视频渲染的共享浏览器。', 'local-asr': '本地语音识别', 'local-asr-desc': 'Whisper.cpp 与随包提供的小型语音识别模型。',
    'system-tts': '系统语音合成', 'system-tts-desc': '使用系统已安装的声音，具体声音取决于系统配置。',
    'audio-transcription': '音频转写', 'audio-creation': '音频制作',
    managerTitle: '社区插件', managerSubtitle: '安装、更新或移除当前绿色版中的第三方 DSH Bundle。更改只作用于当前产品数据目录。',
    packagePlaceholder: 'npm 包名，例如 @example/dsh-plugin', installRegistry: '从 npm 安装', importArchive: '导入 .tgz', importDirectory: '导入源码目录',
    trust: '我了解第三方插件可在本机执行代码，只安装可信来源。', trustRequired: '请先确认第三方代码风险。', noCommunity: '尚未安装社区插件。',
    requested: '安装来源', localDirectory: '本地目录', localArchive: '本地包', registry: 'npm', unknownLocal: '本地来源',
    update: '更新', reinstall: '重新导入', remove: '移除', removeConfirm: '确定移除这个社区插件吗？', working: '正在处理插件…',
    operationFailed: '插件操作失败。', operationDone: '插件配置已更新，重启后生效。', restart: '立即重启生效', output: '操作日志', installedVersion: '版本',
  },
  en: {
    tab: 'Components & versions', title: 'Components & versions', subtitle: 'Inspect the product platform, code runtimes and capability environments. DSH\'s official page owns the plugin inventory and mount state.',
    platform: 'Product & platform', platformHint: 'Hosts the local Agent Core and renders the UI.',
    runtimeGroup: 'Code runtimes', runtimeHint: 'Language runtimes for DSH, plugins, skills and office scripts.',
    capability: 'Capability environments', capabilityHint: 'Shared managed dependencies used on demand by plugins and skills.',
    loading: 'Reading components…', failure: 'Component information is temporarily unavailable.', retry: 'Retry', unknown: 'Undeclared',
    configuration: 'Configuration',
    sourceMode: 'Source / Web', desktopMode: 'Desktop release', core: 'DSH Core', productName: 'Product', runtime: 'Runtime', commit: 'Commit',
    ready: 'Ready', available: 'Bundled', 'not-initialized': 'Not initialized', missing: 'Missing', unavailable: 'Unavailable',
    'release-bundled': 'Release bundled', 'managed-data': 'Product managed', 'offline-seed': 'Offline resource', 'network-managed': 'On demand', source: 'Source environment', system: 'System environment',
    dependsOn: 'Depends on', usedBy: 'Used by', componentPath: 'Path', lockedVersion: 'Locked version', packageFlavor: 'Package', online: 'Online', offline: 'Offline', development: 'Development',
    'desktop-shell': 'Desktop shell', 'dsh-core': 'DSH Core', webview2: 'UI renderer', nodejs: 'Node.js', python: 'Python',
    'office-suite': 'Office document environment', 'browser-automation': 'Browser automation', 'video-production': 'Video production', chromium: 'Shared Chromium',
    'desktop-ui': 'Desktop UI', 'agent-loop': 'Agent loop', documents: 'Documents skill', pdfs: 'PDF skill', presentations: 'Presentations skill', spreadsheets: 'Spreadsheets skill',
    'browser-plugin': 'Browser plugin', 'browser-skill': 'Browser skill', 'web-search': 'Web search', 'video-creation': 'Video creation skill',
    'desktop-shell-desc': 'Current desktop shell, tray, updates and system services.', 'dsh-core-desc': 'Agent Core, sessions and plugin composition.', 'webview2-desc': 'Private WebView2 renderer for the desktop UI.',
    'nodejs-desc': 'Runs DSH Core, plugins and Node tools.', 'python-desc': 'Runs office document and data-processing scripts.',
    'office-suite-desc': 'Shared Python environment for documents, spreadsheets, presentations and PDFs.', 'browser-automation-desc': 'Shared Playwright and Chromium for browser tools, web search and page operations.',
    'video-production-desc': 'Remotion and FFmpeg for video rendering, mixing and encoding.',
    'chromium-desc': 'Shared browser for video rendering.', 'local-asr': 'Local speech recognition', 'local-asr-desc': 'Whisper.cpp and the bundled small transcription model.',
    'system-tts': 'System speech synthesis', 'system-tts-desc': 'Uses installed system voices; availability depends on system configuration.',
    'audio-transcription': 'Audio transcription', 'audio-creation': 'Audio creation',
    managerTitle: 'Community plugins', managerSubtitle: 'Install, update or remove third-party DSH bundles in this desktop profile.',
    packagePlaceholder: 'npm package, e.g. @example/dsh-plugin', installRegistry: 'Install from npm', importArchive: 'Import .tgz', importDirectory: 'Import source folder',
    trust: 'I understand third-party plugins execute local code and will install only trusted sources.', trustRequired: 'Confirm the third-party code warning first.', noCommunity: 'No community plugins installed.',
    requested: 'Source', localDirectory: 'Local folder', localArchive: 'Local archive', registry: 'npm', unknownLocal: 'Local source',
    update: 'Update', reinstall: 'Re-import', remove: 'Remove', removeConfirm: 'Remove this community plugin?', working: 'Working on plugin…',
    operationFailed: 'Plugin operation failed.', operationDone: 'Plugin profile updated. Restart to apply.', restart: 'Restart now', output: 'Operation log', installedVersion: 'Version',
  },
}

const border = 'var(--dsw-alias-border-l2, #e6e6e6)'
const layer = 'var(--dsw-alias-bg-layer-3, #fff)'
const primary = 'var(--dsw-alias-label-primary, #191919)'
const secondary = 'var(--dsw-alias-label-secondary, #666)'
const tertiary = 'var(--dsw-alias-label-tertiary, #888)'
const business = 'var(--dsw-alias-state-business-primary, #9f2636)'
const success = 'var(--dsw-alias-state-success-primary, #3f9b62)'

function unwrap(response) {
  if (!response?.ok) throw new Error(response?.error?.message || 'component inventory failed')
  return response.value
}

const sourceKeys: Record<string, string> = { registry: 'registry', 'local-directory': 'localDirectory', 'local-archive': 'localArchive', 'unknown-local': 'unknownLocal' }

function CommunityPluginManager({ manager, t, onChanged }) {
  const [snapshot, setSnapshot] = useState({ status: 'loading', packages: [] })
  const [spec, setSpec] = useState('')
  const [trusted, setTrusted] = useState(false)
  const [notice, setNotice] = useState('')
  const [job, setJob] = useState(null)

  const refresh = async () => {
    try {
      const value = await manager.list()
      setSnapshot({ status: 'ready', packages: value.packages })
    } catch {
      setSnapshot({ status: 'error', packages: [] })
    }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!job || job.state !== 'running') return
    const timer = window.setInterval(async () => {
      try {
        const next = await manager.job(job.id)
        setJob(next)
        if (next.state !== 'running') {
          window.clearInterval(timer)
          if (next.snapshot) setSnapshot({ status: 'ready', packages: next.snapshot.packages })
          onChanged()
        }
      } catch { window.clearInterval(timer) }
    }, 500)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.state])

  const start = async (action, value) => {
    if (!trusted && (action === 'add-registry' || action === 'import-path')) { setNotice(t('trustRequired')); return }
    setNotice('')
    try { setJob(await manager.start(action, value)) } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }
  const pickAndImport = async kind => {
    if (!trusted) { setNotice(t('trustRequired')); return }
    try {
      const result = kind === 'file' ? await manager.selectFile() : await manager.selectDirectory()
      if (result.path) await start('import-path', result.path)
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }
  const busy = job?.state === 'running'
  return h('section', { style: { marginBottom: 24, paddingBottom: 22, borderBottom: `1px solid ${border}` } },
    h('header', { style: { marginBottom: 12 } },
      h('h3', { style: { margin: '0 0 5px', fontSize: 20 } }, t('managerTitle')),
      h('p', { style: { margin: 0, color: secondary, fontSize: 13, lineHeight: 1.6 } }, t('managerSubtitle'))),
    h('div', { style: { border: `1px solid ${border}`, borderRadius: 11, padding: 13, background: layer } },
      h('div', { style: { display: 'flex', gap: 8 } },
        h('input', { value: spec, disabled: busy, placeholder: t('packagePlaceholder'), onChange: event => setSpec(event.currentTarget.value),
          style: { boxSizing: 'border-box', minWidth: 0, flex: 1, height: 38, border: `1px solid ${border}`, borderRadius: 8, padding: '0 11px', background: layer, color: primary } }),
        h('button', { type: 'button', disabled: busy || !spec.trim(), onClick: () => start('add-registry', spec), style: actionButton(business, true) }, t('installRegistry'))),
      h('div', { style: { display: 'flex', gap: 8, marginTop: 9 } },
        h('button', { type: 'button', disabled: busy, onClick: () => pickAndImport('file'), style: actionButton(secondary) }, t('importArchive')),
        h('button', { type: 'button', disabled: busy, onClick: () => pickAndImport('directory'), style: actionButton(secondary) }, t('importDirectory'))),
      h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 11, color: secondary, fontSize: 12, lineHeight: 1.5, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: trusted, onChange: event => setTrusted(event.currentTarget.checked), style: { marginTop: 2 } }), t('trust')),
      notice ? h('p', { role: 'alert', style: { margin: '9px 0 0', color: 'var(--dsw-alias-state-error-primary, #c33)', fontSize: 12 } }, notice) : null),
    snapshot.status === 'error' ? h('p', { style: { color: 'var(--dsw-alias-state-error-primary, #c33)' } }, t('failure')) :
      snapshot.status === 'loading' ? h('p', { style: { color: tertiary } }, t('loading')) :
      snapshot.packages.length === 0 ? h('p', { style: { color: tertiary, fontSize: 12 } }, t('noCommunity')) :
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, marginTop: 12 } },
        ...snapshot.packages.map(plugin => h('article', { key: plugin.name, style: { border: `1px solid ${border}`, borderRadius: 10, padding: '11px 13px', background: layer, minWidth: 0 } },
          h('strong', { title: plugin.name, style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 } }, plugin.name),
          h('span', { style: { display: 'block', marginTop: 5, color: secondary, fontSize: 11 } }, `${t('installedVersion')} ${plugin.version ?? t('unknown')} · ${t(sourceKeys[plugin.source])}`),
          h('code', { title: plugin.requested, style: { display: 'block', marginTop: 5, color: tertiary, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, plugin.requested),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 9 } },
            plugin.updateable ? h('button', { type: 'button', disabled: busy, onClick: () => start('update', plugin.name), style: actionButton(secondary) }, t('update')) : null,
            h('button', { type: 'button', disabled: busy, onClick: () => { if (window.confirm(t('removeConfirm'))) void start('remove', plugin.name) }, style: actionButton('var(--dsw-alias-state-error-primary, #c33)') }, t('remove')))))),
    job ? h('div', { role: job.state === 'failed' ? 'alert' : 'status', style: { marginTop: 12, border: `1px solid ${job.state === 'failed' ? 'var(--dsw-alias-state-error-primary, #c33)' : border}`, borderRadius: 10, padding: 12, background: layer } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' } },
        h('strong', { style: { fontSize: 12 } }, job.message || (busy ? t('working') : job.state === 'failed' ? t('operationFailed') : t('operationDone'))),
        job.requiresRestart ? h('button', { type: 'button', onClick: () => manager.restart(), style: actionButton(business, true) }, t('restart')) : null),
      job.output ? h('details', { style: { marginTop: 9 } }, h('summary', { style: { cursor: 'pointer', color: secondary, fontSize: 11 } }, t('output')),
        h('pre', { style: { maxHeight: 190, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0 0', padding: 9, borderRadius: 7, background: 'var(--dsw-alias-bg-layer-2, #f6f6f6)', color: secondary, fontSize: 10 } }, job.output)) : null) : null)
}

function actionButton(color, filled = false) {
  return { border: `1px solid ${color}`, borderRadius: 8, padding: '7px 10px', background: filled ? color : 'transparent', color: filled ? '#fff' : color, cursor: 'pointer', fontSize: 12 }
}

const statusColors = {
  ready: success,
  available: 'var(--dsw-alias-state-info-primary, #3778c2)',
  'not-initialized': tertiary,
  missing: 'var(--dsw-alias-state-error-primary, #c33)',
  unavailable: tertiary,
}

function ComponentLayers({ components, t }) {
  const groups = [
    ['platform', 'platform', 'platformHint'],
    ['runtime', 'runtimeGroup', 'runtimeHint'],
    ['capability', 'capability', 'capabilityHint'],
  ]
  return h('div', { style: { display: 'grid', gap: 22, marginBottom: 26 } },
    ...groups.map(([category, title, hint]) => {
      const rows = components.filter(item => item.category === category)
      if (rows.length === 0) return null
      return h('section', { key: category },
        h('header', { style: { marginBottom: 10 } },
          h('h4', { style: { margin: 0, fontSize: 15 } }, t(title)),
          h('p', { style: { margin: '4px 0 0', color: secondary, fontSize: 11, lineHeight: 1.5 } }, t(hint))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, alignItems: 'start' } },
          ...rows.map(item => {
            const color = statusColors[item.status] ?? tertiary
            const detailRows = [
              [t('lockedVersion'), item.version ?? t('unknown')],
              [t('configuration'), t(item.source)],
              ...(item.path ? [[t('componentPath'), item.path]] : []),
              ...(item.dependencies.length ? [[t('dependsOn'), item.dependencies.map(value => t(value)).join('、')]] : []),
              ...(item.consumers.length ? [[t('usedBy'), item.consumers.map(value => t(value)).join('、')]] : []),
              ...item.metadata.map(value => [value.key, value.value]),
            ]
            return h('details', { key: item.id, style: { minWidth: 0, border: `1px solid ${border}`, borderRadius: 10, background: layer, overflow: 'hidden' } },
              h('summary', { style: { listStyle: 'none', cursor: 'pointer', padding: '12px 13px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9 } },
                  h('strong', { style: { minWidth: 0, fontSize: 13 } }, t(item.id)),
                  h('span', { style: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 5, padding: '2px 7px', background: `color-mix(in srgb, ${color} 12%, transparent)`, color, fontSize: 11 } },
                    h('span', { 'aria-hidden': true, style: { width: 6, height: 6, borderRadius: '50%', background: color } }), t(item.status))),
                h('p', { style: { margin: '6px 0 0', color: secondary, fontSize: 11, lineHeight: 1.5 } }, t(`${item.id}-desc`)),
                h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, color: tertiary, fontSize: 10 } },
                  h('span', null, item.version ?? t('unknown')), h('span', null, t(item.source)))),
              h('div', { style: { borderTop: `1px solid ${border}`, padding: '10px 13px 12px', background: 'var(--dsw-alias-bg-layer-2, #fafafa)' } },
                h('dl', { style: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '6px 14px', margin: 0, color: secondary, fontSize: 10 } },
                  ...detailRows.flatMap(([label, value]) => [h('dt', { key: `${item.id}-${label}-dt` }, label), h('dd', { key: `${item.id}-${label}-dd`, title: value, style: { margin: 0, overflowWrap: 'anywhere', color: primary } }, value)]))))
          })))
    }))
}

function ComponentInventory({ list, manager, t }) {
  const [state, setState] = useState({ status: 'loading' })
  const [request, setRequest] = useState(0)
  useEffect(() => {
    let active = true
    list().then(value => { if (active) setState({ status: 'ready', value }) }, () => { if (active) setState({ status: 'error' }) })
    return () => { active = false }
  }, [list, request])
  if (state.status === 'loading') return h('p', { style: { color: tertiary } }, t('loading'))
  if (state.status === 'error') return h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #c33)' } },
    h('span', null, t('failure')), ' ', h('button', { type: 'button', onClick: () => { setState({ status: 'loading' }); setRequest(value => value + 1) } }, t('retry')))
  const release = state.value.release
  return h('div', { style: { width: '100%', maxWidth: 820, color: primary } },
    h('header', { style: { marginBottom: 18 } }, h('h3', { style: { margin: '0 0 5px', fontSize: 20 } }, t('title')),
      h('p', { style: { margin: 0, color: secondary, fontSize: 13, lineHeight: 1.6 } }, t('subtitle'))),
    h('article', { style: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', background: layer, marginBottom: 20 } },
      h('div', null, h('span', { style: { display: 'block', color: tertiary, fontSize: 10 } }, t('productName')),
        h('strong', { style: { display: 'block', marginTop: 4, fontSize: 15 } }, release.productVersion)),
      h('div', { style: { display: 'flex', gap: 18, color: secondary, fontSize: 10, textAlign: 'right' } },
        h('span', null, release.distributionMode === 'desktop-release' ? t('desktopMode') : t('sourceMode')),
        release.packageFlavor ? h('span', null, `${t('packageFlavor')} · ${t(release.packageFlavor)}`) : null)),
    h(ComponentLayers, { components: state.value.components, t }),
    // These import/restart controls use native desktop dialogs. Plain local
    // Web keeps the official DSH plugin page and the read-only inventory.
    release.distributionMode === 'desktop-release'
      ? h(CommunityPluginManager, { manager, t, onChanged: () => setRequest(value => value + 1) }) : null)
}

export async function apply(ctx) {
  const [disposeInventory, disposeManager] = await Promise.all([ctx.remote.$mount(componentInventoryRemote), ctx.remote.$mount(pluginManagerRemote)])
  ctx.effect(() => () => { void disposeInventory(); void disposeManager() }, 'component-inventory: remotes')
  ctx.inject(['remote.productComponents', 'remote.productPluginManager'], surfaceCtx => {
    const language = surfaceCtx.locale.getSnapshot?.().locale ?? 'zh'
    const dictionary = String(language).toLowerCase().startsWith('zh') ? copy.zh : copy.en
    const t = key => dictionary[key] ?? key
    const list = async () => unwrap(await surfaceCtx.remote.productComponents.list())
    const manager = {
      list: async () => unwrap(await surfaceCtx.remote.productPluginManager.list()),
      selectFile: async () => unwrap(await surfaceCtx.remote.productPluginManager.selectFile()),
      selectDirectory: async () => unwrap(await surfaceCtx.remote.productPluginManager.selectDirectory()),
      start: async (action, value) => unwrap(await surfaceCtx.remote.productPluginManager.start(action, value)),
      job: async jobID => unwrap(await surfaceCtx.remote.productPluginManager.job(jobID)),
      restart: async () => unwrap(await surfaceCtx.remote.productPluginManager.restart()),
    }
    surfaceCtx.slots.inject('settings.plugins.tab', () => surfaceCtx.slots.register({
      name: 'settings.plugins.tab', id: 'components', order: 20, label: () => t('tab'), inject: () => ({ list, manager, t }),
    }, ComponentInventory))
  })
}
