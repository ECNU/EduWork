import React from 'react'

const element = React.createElement

export function portableMigrationPrompt(migration) {
  return Boolean(migration && !migration.dismissed)
}

export function PortableMigrationUpgrade({ migration, run, locked, button, primary, note }) {
  if (!migration) return null
  return element('section', { 'data-eduwork-portable-migration': true, style: { marginTop: 16 } },
    element('div', { style: { fontSize: 14 } }, `迁移到安装版 ${migration.version}`),
    element('p', { style: note }, '保留旧便携目录；使用同一 Windows 账户可迁移会话、设置与凭据。安装版已有的数据不会合并或覆盖。'),
    migration.busy ? element('p', { role: 'status', style: note }, '正在下载、校验或准备安装，请稍候…')
      : element('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
        element('button', { type: 'button', disabled: locked, style: primary, onClick: () => run('start-portable-migration') }, '升级并迁移'),
        !migration.dismissed && element('button', { type: 'button', style: button, onClick: () => run('dismiss-portable-migration') }, '稍后')))
}
