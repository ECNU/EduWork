import { Menu } from 'electron'

// Application-menu refreshes also update existing Windows/Linux windows.
// Keep startup and recovery windows menu-free across locale/shortcut changes.
const menuLessWindows = new Set()
export function removeWindowMenu(window) {
  if (process.platform === 'darwin') return
  window.removeMenu()
  menuLessWindows.add(window)
  window.once('closed', () => menuLessWindows.delete(window))
}

export function setDesktopApplicationMenu(menu) {
  Menu.setApplicationMenu(menu)
  for (const window of menuLessWindows) if (!window.isDestroyed()) window.removeMenu()
}

export function desktopEditMenu({ id, messages }) {
  return { role: 'editMenu', label: messages.edit, submenu: [
    { role: 'undo', label: messages.undo }, { role: 'redo', label: messages.redo },
    { type: 'separator' },
    { role: 'cut', label: messages.cut }, { role: 'copy', label: messages.copy },
    { role: 'paste', label: messages.paste },
    ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle', label: id.startsWith('zh') ? '粘贴并匹配样式' : 'Paste and Match Style' }] : []),
    { role: 'delete', label: messages.delete }, { type: 'separator' },
    { role: 'selectAll', label: messages.selectAll },
  ] }
}

export function desktopViewMenu({ id, messages }) {
  const zh = id.startsWith('zh')
  return { role: 'viewMenu', label: zh ? '视图' : 'View', submenu: [
    { role: 'reload', label: messages.reloadPageMenu },
    { role: 'toggleDevTools', label: zh ? '开发者工具' : 'Toggle Developer Tools' },
    { type: 'separator' },
    { role: 'resetZoom', label: zh ? '实际大小' : 'Actual Size' },
    { role: 'zoomIn', label: zh ? '放大' : 'Zoom In' },
    { role: 'zoomOut', label: zh ? '缩小' : 'Zoom Out' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: zh ? '切换全屏' : 'Toggle Full Screen' },
  ] }
}
