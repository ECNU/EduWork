import React from 'react'

const element = React.createElement

export function portableMigrationPrompt(migration) {
  return Boolean(migration && (!migration.dismissed || migration.busy))
}

export const portableMigrationPercent = migration => Math.min(100, Math.floor((migration.downloadedBytes || 0) / migration.totalBytes * 100))

export function PortableMigrationUpgrade({ migration, run, locked, button, primary, note, border, hasPortableUpdate, size, progressBar }) {
  if (!migration) return null
  const { stage } = migration
  const determinate = stage === 'downloading' && migration.totalBytes > 0
  const progress = determinate ? portableMigrationPercent(migration) : undefined
  const message = stage === 'downloading' ? `正在下载安装版 ${migration.version}…` : stage === 'verifying' ? '正在校验安装包…'
    : stage === 'stopping' ? '正在关闭当前客户端并启动安装程序…' : '正在准备迁移…'
  return element('section', { 'data-eduwork-portable-migration': true, style: { borderTop: `1px solid ${border}`, paddingTop: 16, marginTop: 16 } },
    element('div', { style: { fontSize: 14 } }, `升级为标准安装版 ${migration.version}`),
    element('p', { style: note }, '将自动安装并导入当前会话、工作区、设置与模型配置，支持开始菜单与系统卸载。原便携目录保持原样，安装版已有数据时不会覆盖或合并。' +
      (hasPortableUpdate ? '无需先更新便携版，可直接升级并迁移。' : '')),
    migration.busy ? element(React.Fragment, null,
      element('p', { role: 'status', style: note }, message),
      progressBar('迁移安装包下载进度', progress),
      determinate && element('p', { style: note }, `${size(migration.downloadedBytes || 0)} / ${size(migration.totalBytes)} · ${progress}%`),
      element('p', { style: note }, '下载完成后将确认退出当前客户端并启动安装程序，请先保存正在运行的任务。'),
      migration.cancellable && element('button', { type: 'button', style: { ...button, marginTop: 8 }, onClick: () => run('cancel-portable-migration') }, '取消下载'))
      : element('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
        element('button', { type: 'button', disabled: locked, style: primary, onClick: () => run('start-portable-migration') }, '升级并迁移'),
        !migration.dismissed && element('button', { type: 'button', style: button, onClick: () => run('dismiss-portable-migration') }, '稍后')))
}
