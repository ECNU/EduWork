// Apply only to byte-verified rc.2 inputs. Desktop mechanics remain upstream;
// edition account, update and recovery policy are composed by native-desktop.
export function adaptNativeDesktopSource(file, source) {
  const replace = (from, to) => {
    if (source.split(from).length !== 2) throw new Error(`Native desktop anchor changed in ${file}: ${from.slice(0, 80)}`)
    source = source.replace(from, to)
  }
  if (file.endsWith('/main.ts')) {
    const start = source.indexOf('function createWindow(')
    const end = source.indexOf('\nasync function main()', start)
    if (start < 0 || end < 0) throw new Error('Official window factory boundary changed')
    // Extract the official platform window factory, not its DeepSeek account,
    // installer or profile ownership. Its input file hash is in the receipt.
    source = `import { BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { DESKTOP_IPC, SCHEME } from './ipc.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
import { resolveDesktopLocale } from './locale.ts'
import { app } from 'electron'
const currentDesktopLocale = () => resolveDesktopLocale(app.getLocale())
const chromeFallbackFill = () => nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'
export ${source.slice(start, end)}
`
    const popup = source.slice(source.indexOf('  window.webContents.setWindowOpenHandler('), source.indexOf("  if (process.platform === 'darwin')"))
    replace(popup, '')
    const navigation = source.slice(source.indexOf("  window.webContents.on('will-navigate'"), source.indexOf('  return window'))
    replace(navigation, '')
  }
  if (file.endsWith('/preload-app.ts')) {
    replace("import { PLATFORM_IPC } from './platform-ipc.ts'\n", '')
    replace("import { installMandatoryUpdateOverlay } from './preload-mandatory-overlay.ts'\n", '')
    replace("  if (process.platform === 'win32') installMandatoryUpdateOverlay()\n", '')
    const onboarding = source.slice(source.indexOf("  contextBridge.exposeInMainWorld('dshOnboarding'"), source.indexOf('  ipcRenderer.on(DESKTOP_IPC.enterWorkspace'))
    replace(onboarding, '')
    const platform = source.slice(source.indexOf("  contextBridge.exposeInMainWorld('dshPlatform'"), source.indexOf('\n}\n\nmarkDocumentPlatform()'))
    replace(platform, '')
  }
  if (file.endsWith('/microphone-permissions.ts')) {
    // Keep the official main-frame/audio/OS checks, with the product's deny
    // default. Clipboard writes are the one required non-media permission.
    replace("if (permission !== 'media') return true", "if (permission !== 'media') return permission === 'clipboard-sanitized-write' && contents === primary() && details.isMainFrame && applicationFrame(origin)")
    replace("if (permission !== 'media') { callback(true); return }", "if (permission !== 'media') { callback(permission === 'clipboard-sanitized-write' && contents === primary() && details.isMainFrame && applicationFrame(details.requestingUrl)); return }")
  }
  if (file.endsWith('/fatal-recovery.ts')) {
    // Disabling all plugins also disables this distribution's essential login,
    // Studio and service adapters. Offer restart/exit, not that destructive path.
    replace(': [messages.exitApplication, messages.restartApplication, messages.disableThirdPartyPlugins]', ': [messages.exitApplication, messages.restartApplication]')
  }
  return source
}
