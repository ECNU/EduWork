import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../src/native-desktop-bridge.mjs', import.meta.url), 'utf8')
const desktop = readFileSync(new URL('../src/native-desktop.mjs', import.meta.url), 'utf8')

test('the application menu offers the user guide only after the Host serves it', () => {
  assert.match(bridge, /export const USER_GUIDE_ROUTE = '\/eduwork-user-guide'/)
  assert.match(bridge, /export const USER_GUIDE_EVENT = 'eduwork:open-user-guide'/)
  assert.match(bridge, /\.\.\.\(userGuide \? \[\{ label: [^\]]*click: openUserGuide \}\] : \[\]\)/)
  assert.match(bridge, /getHost\(\)\?\.fetch\(new Request\(`app:\/\/app\$\{USER_GUIDE_ROUTE\}\/`, \{ method: 'HEAD' \}\)\)/)
  assert.match(bridge, /response\?\.ok === true/)
  // Windows draws the 应用 menu from the same item list as the macOS app menu.
  assert.match(bridge, /name === 'application' \? applicationItems\(\)/)
  assert.ok(desktop.indexOf('bridge.probeUserGuide()') > desktop.indexOf('bridge.attach(window)'))
})

test('opening the guide only dispatches a fixed window event', () => {
  const open = bridge.slice(bridge.indexOf('const openUserGuide'), bridge.indexOf('const applicationItems'))
  assert.match(open, /executeJavaScript\(`window\.dispatchEvent\(new Event\(\$\{JSON\.stringify\(USER_GUIDE_EVENT\)\}\)\)`\)/)
  assert.match(open, /isDestroyed\(\)/)
})
