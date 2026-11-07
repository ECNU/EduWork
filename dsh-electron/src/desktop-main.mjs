// Playwright and Remotion start this executable as their browser. Take that
// role before any desktop module claims the single instance or the profile.
import { app, protocol } from 'electron'
import { automationBrowserMode, runAutomationBrowser } from './automation-browser.mjs'
import { SCHEME } from './ipc.ts'
import { PET_SCHEME } from './desktop-pet-core.mjs'
import { installedStartupId } from './installed-startup-check.mjs'

const mode = automationBrowserMode(app.commandLine)
if (mode) runAutomationBrowser(mode)
else {
  // Register privileges before asynchronous data preparation can reach app.ready.
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
  } }, { scheme: PET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
  let verifyingUpdate = false
  try {
    verifyingUpdate = process.platform === 'win32' && Boolean(installedStartupId(process.argv.slice(1)))
    const { runInstalledFirstLaunch } = await import('./installed-first-run.mjs')
    if (!await runInstalledFirstLaunch({ verifyingUpdate })) await import('./native-desktop.mjs')
  } catch (error) {
    if (!verifyingUpdate) {
      const { dialog } = await import('electron')
      dialog.showErrorBox('EduWork 启动未完成', `${error.message}\n旧数据未被覆盖，请保留原目录。`)
    }
    app.exit(1)
  }
}
