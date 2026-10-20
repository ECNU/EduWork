// MIT: DeepSeek Harness, pinned input main.ts SHA256 e345eda0425f2df795d20413bb87bb9a3ddc46e71ceb1cec0755ad1cca3fb847
function createWindow(preload: string, show = false, primary = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: primary,
      devTools: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // Fullscreen hides native window controls; overlays drop their caption clearance.
    const sendFullscreen = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    // Reloads and navigations re-register the preload listener; resend the
    // current state so a fullscreen reload does not fall back to windowed CSS.
    window.webContents.on('did-finish-load', sendFullscreen)
  }
  if (process.platform === 'darwin') {
    // Deminiaturize reattaches the NSVisualEffectView material late
    // (electron/electron#25368), so a transparent window shows the desktop
    // through the sidebar until then. Paint an opaque base while minimized or
    // hidden so the deminiaturize animation and the reattachment gap show a
    // solid fill; restoring flips back, and the null -> 'sidebar' transition
    // forces the material to reattach.
    const applyBackdrop = (): void => {
      if (window.isDestroyed()) return
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null)
        window.setBackgroundColor(chromeFallbackFill())
      } else {
        window.setVibrancy('sidebar')
        window.setBackgroundColor('#00000000')
      }
    }
    window.on('minimize', applyBackdrop)
    window.on('hide', applyBackdrop)
    window.on('restore', applyBackdrop)
    window.on('show', applyBackdrop)
  }
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = currentDesktopLocale().messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (['http:', 'https:'].includes(destination.protocol)) void shell.openExternal(url)
    }
  })
  return window
}


async function main() {}
