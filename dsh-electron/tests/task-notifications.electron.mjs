// Native API smoke. Run with Electron, not Node. Uses a fresh application profile.
// Emitted native events prove API delivery only; visual/click/DND acceptance is separate.
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TaskNotifications, nativeNotificationAdapter } from '../src/task-notifications.mjs'
import { applyDesktopBrand } from '../src/desktop-brand.mjs'
import { notificationDefaults } from '../../dsh-plugins/desktop-services/lib/attention.js'

const evidence = process.env.EDUWORK_TEST_EVIDENCE
if (!evidence) throw Error('Set EDUWORK_TEST_EVIDENCE to an isolated output directory')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'eduwork-notification-native-')))
const productName = process.env.EDUWORK_TEST_PRODUCT_NAME || 'EduWork'
applyDesktopBrand(app, process.platform, { productName, appId: 'org.eduwork.notification-test' })
async function run() {
const events = [], window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
const tray = new Tray(nativeImage.createFromPath(fileURLToPath(new URL('../../assets/eduwork/icon-32.png', import.meta.url))))
tray.setToolTip('EduWork notification test')
const adapter = nativeNotificationAdapter({ platform: process.platform, Notification, getTray: () => tray, productName, activate: key => broker.activate(key), failed: () => events.push('native-failed') })
const broker = new TaskNotifications({ foreground: () => window.isFocused(), show: () => { events.push('window-restored'); window.show(); window.focus() },
  publish: value => { adapter.publish(value); events.push('native-api-called') }, dismiss: () => adapter.dismiss(),
  changed: () => tray.setContextMenu(Menu.buildFromTemplate(broker.menu())) })
tray.on('balloon-show', () => events.push('balloon-show'))
tray.on('balloon-click', () => adapter.balloonClick())
try {
  broker.handle({ action: 'sync', instance: 'fixture', preferences: notificationDefaults, items: [{ key: 'fixture-approval', kind: 'approval', sessionId: 'fixture', title: '', createdAt: Date.now() }] })
  await new Promise(resolve => setTimeout(resolve, 5000))
  const menuItems = broker.menu().length
  broker.menu()[0].click()
  const target = broker.handle({ action: 'view', sessionId: 'fixture' }).openKey
  broker.handle({ action: 'sync', instance: 'fixture', preferences: notificationDefaults, items: [] })
  assert.equal(menuItems, 1)
  assert.equal(target, 'fixture-approval')
  assert.equal(broker.menu().length, 0)
  assert.ok(events.includes('native-api-called'))
  assert.ok(events.includes('window-restored'))
  await mkdir(evidence, { recursive: true })
  await writeFile(join(evidence, 'native-notifications.json'), JSON.stringify({ success: true, platform: process.platform, electron: process.versions.electron, productName: app.getName(), events, menuItems, target, cleared: broker.menu().length === 0,
    scope: 'Native tray/notification API and programmatic menu navigation; does not certify visual delivery, OS permissions, historical toast clicks or DND.' }, null, 2))
} finally { broker.close(); tray.destroy(); window.destroy(); app.quit() }
}
void app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
