// Playwright and Remotion start this executable as their browser. Take that
// role before any desktop module claims the single instance or the profile.
import { app } from 'electron'
import { automationBrowserMode, runAutomationBrowser } from './automation-browser.mjs'

const mode = automationBrowserMode(app.commandLine)
if (mode) runAutomationBrowser(mode)
else await import('./native-desktop.mjs')
