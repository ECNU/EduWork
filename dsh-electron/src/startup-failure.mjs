const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const MAX_DIAGNOSTIC_MESSAGE = 8192
// V8 includes the offending input in some JSON.parse messages. The excerpt can
// contain unescaped inner quotes or a truncated tail, so match the whole quoted
// region up to the fixed suffix instead of assuming escaped content.
const JSON_INPUT_EXCERPT = /(Unexpected token [^\n]*?,\s*)(?:\.\.\.)?\s*"[\s\S]*?"\s*(?:\.\.\.)?\s+is not valid JSON/gu
const LOOPBACK_ENDPOINT = /(?:https?|wss?):\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?(?:\/[^\s"']*)?|(?<![\w.-])(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?(?![\w.-])/giu
const scrubDiagnosticText = text => text
  // Keep the token/position prefix; lazy matching stops at the closing quote
  // even when the excerpt contains inner quotes or newlines.
  .replace(JSON_INPUT_EXCERPT, '$1[配置内容已隐藏] is not valid JSON')
  .replace(LOOPBACK_ENDPOINT, '[Host 地址已隐藏]')

// Preserve aggregate/cause reasons and stable diagnostic codes, but never copy
// arbitrary error properties, stacks or unredacted input into the dialog/report.
export function startupDiagnostic(error, redact = value => value) {
  const visited = new Set()
  const message = value => {
    const text = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '')
    return redact(scrubDiagnosticText(text)).slice(0, MAX_DIAGNOSTIC_MESSAGE)
  }
  // Keep each error's message as one block. A wrapper often repeats its cause
  // verbatim; only drop a block already covered by the wrapper text, so two
  // components that both report EPERM keep their own context and line order.
  const appendBlock = (parts, text) => {
    const block = message(text)
    if (block && !parts.some(part => part.includes(block))) parts.push(block)
    return parts
  }
  const merge = (parts, value, depth, seen) => {
    if (depth > 6) { appendBlock(parts, '[诊断信息层级过深，已省略]'); return }
    if (value === undefined || value === null) return
    if (value instanceof AggregateError) {
      if (seen.has(value)) { appendBlock(parts, '[重复的诊断信息，已省略]'); return }
      seen.add(value)
      appendBlock(parts, value.message)
      // Children are distinct failures. Skip one only when the wrapper or the
      // aggregate message already contains its whole block, not when an earlier
      // sibling happens to share a line such as the same error code.
      const wrapper = parts.slice()
      for (const item of value.errors.slice(0, 8)) {
        const child = []
        merge(child, item, depth + 1, seen)
        for (const block of child) if (!wrapper.some(part => part.includes(block))) parts.push(block)
      }
      return
    }
    if (value instanceof Error) {
      if (seen.has(value)) { appendBlock(parts, '[重复的诊断信息，已省略]'); return }
      seen.add(value)
      appendBlock(parts, value.message)
      if (value.cause !== undefined) merge(parts, value.cause, depth + 1, seen)
      return
    }
    appendBlock(parts, String(value ?? ''))
  }
  const chain = value => {
    const parts = [], seen = new Set()
    if (value instanceof AggregateError) {
      // The top-level aggregate keeps its children in the structured errors;
      // its message carries only the aggregate reason and its cause chain.
      seen.add(value)
      appendBlock(parts, value.message)
      if (value.cause !== undefined) merge(parts, value.cause, 1, seen)
    } else merge(parts, value, 0, seen)
    return parts.join('\n')
  }
  const copy = (safe, source) => {
    const field = value => typeof value === 'string' ? redact(scrubDiagnosticText(value)) : ''
    const code = field(source.code), syscall = field(source.syscall)
    if (/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) safe.code = code
    if (Number.isInteger(source.errno) && source.errno < 0) safe.errno = source.errno
    if (/^[a-z][a-z0-9_]{0,31}$/u.test(syscall)) safe.syscall = syscall
  }
  const walk = (value, depth) => {
    if (depth > 6) return new Error('[诊断信息层级过深，已省略]')
    if (value instanceof AggregateError) {
      if (visited.has(value)) return new Error('[重复的诊断信息，已省略]')
      visited.add(value)
      const safe = new AggregateError(value.errors.slice(0, 8).map(item => walk(item, depth + 1)), chain(value))
      copy(safe, value)
      return safe
    }
    if (value instanceof Error) {
      if (visited.has(value)) return new Error('[重复的诊断信息，已省略]')
      visited.add(value)
      const safe = new Error(chain(value))
      copy(safe, value)
      return safe
    }
    return new Error(message(value))
  }
  return walk(error, 0)
}

export function updaterStartupError(executable, cause) {
  return Object.assign(new Error(`无法启动必需的更新组件：${executable}\n${cause.message}`, { cause }), {
    code: 'EDUWORK_UPDATER_START_FAILED', executable,
  })
}

export function startupFailurePage({ error, productName, version, config }) {
  const causes = []
  for (let current = error; current && causes.length < 8; current = current.cause) causes.push(current)
  const updater = causes.find(value => value.code === 'EDUWORK_UPDATER_START_FAILED')
  const needsConfiguration = causes.some(value => value.code === 'EDUWORK_BOOTSTRAP_REQUIRED')
  let body, diagnostics
  if (updater) {
    const code = updater.cause?.code ?? 'UNKNOWN'
    const denied = ['EACCES', 'EPERM'].includes(code)
    const missing = code === 'ENOENT'
    const reason = denied ? 'Windows 拒绝运行更新组件，可能与安全软件拦截或文件执行权限有关。'
      : missing ? '系统未找到更新组件，可能未完整解压，或文件已被移走、隔离。'
      : '系统未能运行更新组件，请检查文件完整性及系统限制。'
    const steps = denied ? [
      '查看 Windows 安全中心或安全软件的拦截记录，确认是否涉及下方组件。',
      '若文件存在且没有拦截记录，检查目录和文件的读取、执行权限；受管理的电脑请联系管理员。',
      '若文件缺失或解压不完整，请从发行方重新下载完整安装包，解压到新的可写目录。保留原目录中的 config 和 data。',
    ] : [
      '检查下方组件文件是否存在，并查看安全软件是否将其拦截或隔离。',
      '从发行方重新下载完整安装包，解压到新的可写目录。保留原目录中的 config 和 data。',
    ]
    diagnostics = scrubDiagnosticText(`产品：${productName}\n版本：${version ?? '未知'}\n故障组件：自动更新服务\n组件文件：${updater.executable}\n错误代码：${code}\n原始错误：${causes.filter(value => value !== updater).map(value => value.message || String(value)).join('\n原因：')}`)
    body = `<div class="failure"><strong>更新组件无法运行</strong><p>${escape(reason)}</p></div>
      <p>这是启动所需的组件。修复后才能启动，原有配置和历史数据不会被重置。</p>
      <p class="component">组件文件：<code>${escape(updater.executable)}</code></p>
      <ol>${steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
      <p>若仍无法启动，请复制错误信息交给维护人员。</p>
      <details><summary>技术详情（${escape(code)}）</summary><pre>${escape(diagnostics)}</pre></details>`
  } else {
    body = `<p>${needsConfiguration ? '首次使用需要下载发行配置。请连接网络后重试，也可导入发行方提供的签名离线包。' : '修正以下问题后可重新启动。原有配置和历史数据不会被重置。'}</p>
      <pre class="failure">${escape(scrubDiagnosticText(String(error.message || error)))}</pre><p>配置文件：${escape(config)}</p>`
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(productName)} · 启动提示</title>
    <style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{font:15px/1.6 system-ui;margin:28px;color:#313744;background:#faf8f4;overflow-wrap:anywhere}
      h1{font-size:22px;line-height:1.4;margin:0 0 20px}p{margin:12px 0}.failure{background:#fff0f1;padding:14px 16px;color:#9f2636;border-radius:8px}.failure p{margin:4px 0 0}
      pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}code{font-size:13px}.component{padding:10px 12px;background:#eeeae5;border-radius:6px}
      ol{padding-left:24px}li{margin:8px 0}summary{cursor:pointer}details{margin:16px 0}details pre{background:#eeeae5;padding:12px;border-radius:6px}
      nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}a{display:inline-block;padding:8px 12px;border:1px solid #aaa;border-radius:6px;color:inherit;text-decoration:none}
      a.primary{background:#9f2636;border-color:#9f2636;color:white}a:hover{filter:brightness(.93)}a:focus-visible,summary:focus-visible{outline:3px solid #9f2636;outline-offset:3px}
      #copy-status{font-size:13px;min-height:1.6em;margin:8px 0 0}@media(max-width:480px){body{margin:20px}}
      @media(prefers-color-scheme:dark){body{color:#eee;background:#1c1c1c}.failure{background:#382126;color:#ffb4be}.component,details pre{background:#292929}a:focus-visible,summary:focus-visible{outline-color:#ffb4be}}
    </style><h1>${escape(productName)} ${needsConfiguration ? '正在等待发行配置' : '暂时未能启动'}</h1>${body}
    <nav aria-label="恢复操作"><a class="primary" href="eduwork-startup://restart/">${needsConfiguration ? '重试下载' : updater ? '修复后重试' : '重新启动'}</a>
    ${needsConfiguration ? '<a href="eduwork-startup://import/">导入离线配置包</a>' : ''}
    ${updater ? '<a href="eduwork-startup://component/">打开组件目录</a><a href="eduwork-startup://copy/">复制错误信息</a>' : ''}
    <a href="eduwork-startup://exit/">退出</a></nav>${updater ? '<p id="copy-status" role="status" aria-live="polite"></p>' : ''}</html>`
  return { html, needsConfiguration, diagnostics, executable: updater?.executable }
}
