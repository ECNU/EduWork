function displayProgress({ copied, total } = {}) {
  if (Number.isSafeInteger(copied) && Number.isSafeInteger(total) && copied > 0 && copied < total) {
    return { copied, total, label: `正在迁移数据（${copied} / ${total} 个文件）…` }
  }
  return { label: copied === undefined ? '正在检查原有数据…' : '正在校验迁移完整性…' }
}

export function migrationProgressPage(progress) {
  const { copied, total, label } = displayProgress(progress)
  const attributes = total ? ` max="${total}" value="${copied}"` : ''
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>迁移 EduWork 数据</title>
<style>:root{color-scheme:light dark;color:CanvasText;background:Canvas}body{font:15px/1.5 system-ui;margin:22px 24px}h1{font-size:20px;margin:0 0 10px}progress{display:block;width:100%;margin:8px 0 12px;clip-path:inset(0 round 6px);accent-color:light-dark(#245dc1,#8db6ff)}p{font-size:13px;margin:0}</style>
<main><h1>迁移 EduWork 数据</h1><label for="progress">${label}</label><progress id="progress"${attributes}></progress>
<p>完成后将自动打开工作台，原便携目录不会被修改，请稍候。</p></main></html>`
}

export async function withMigrationProgress(BrowserWindow, run) {
  const window = new BrowserWindow({ width: 460, height: 220, show: false, resizable: false, closable: false,
    autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'eduwork-first-run' } })
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(migrationProgressPage())}`)
    window.show()
    window.setProgressBar(2)
    return await run(progress => {
      if (window.isDestroyed()) return
      const { copied, total, label } = displayProgress(progress)
      window.setProgressBar(total ? copied / total : 2)
      void window.webContents.executeJavaScript(`{
        const progress = document.querySelector('progress');
        document.querySelector('label').textContent = ${JSON.stringify(label)};
        ${total ? `progress.max = ${total}; progress.value = ${copied};` : "progress.removeAttribute('value');"}
      }`).catch(() => {})
    })
  } finally { if (!window.isDestroyed()) window.destroy() }
}
