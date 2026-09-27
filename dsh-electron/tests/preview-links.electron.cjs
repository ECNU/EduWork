// Run in an isolated Electron harness with TEST_SOURCE, TEST_OUTPUT and
// TEST_MEDIA (directory containing a synthetic video.mp4). No user profile is used.
const { app, BrowserWindow, protocol } = require('electron')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
app.setPath('userData', join(process.env.TEST_OUTPUT, 'profile'))
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.whenReady().then(async () => {
  let window, fixture
  try {
    const { attachExternalNavigation } = await import(pathToFileURL(join(process.env.TEST_SOURCE, 'dsh-electron/src/external-navigation.mjs')))
    fixture = createServer((_request, response) => {
      response.setHeader('Content-Type', 'video/mp4')
      response.end(fs.readFileSync(join(process.env.TEST_MEDIA, 'video.mp4')))
    })
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${fixture.address().port}/sample.mp4`
    protocol.handle('dsh-app', () => new Response('<!doctype html><title>Preview bridge fixture</title><video controls></video>', { headers: { 'content-type': 'text/html' } }))
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: join(process.env.TEST_SOURCE, 'dsh-electron/src/preview-links-preload.cjs') } })
    const opened = []
    attachExternalNavigation(window.webContents, value => opened.push(value), error => { throw error }, value => opened.push(value))
    await window.loadURL('dsh-app://app/index.html')
    const ready = new Promise(resolve => window.webContents.on('ipc-message', (_event, channel) => { if (channel === 'eduwork:preview-ready') resolve() }))
    await window.webContents.executeJavaScript(`window.loaded = new Promise((resolve, reject) => {
      const video = document.querySelector('video'); video.onloadedmetadata = () => resolve({ width: video.videoWidth, duration: video.duration }); video.onerror = () => reject(Error('media decode failed'));
      window.unsubscribe = window.eduworkPreviewLinks.subscribe(url => { video.src = url; video.load() });
    }); true`)
    await ready
    await window.webContents.executeJavaScript(`window.open(${JSON.stringify(url)}); true`)
    const metadata = await Promise.race([window.webContents.executeJavaScript('window.loaded'), new Promise((_, reject) => setTimeout(() => reject(Error('media timeout')), 20000))])
    assert(metadata.width > 0 && metadata.duration > 0)
    assert.deepEqual(opened, [])
    const external = new Promise(resolve => window.webContents.on('ipc-message', (_event, channel) => { if (channel === 'eduwork:preview-external') setImmediate(resolve) }))
    await window.webContents.executeJavaScript(`window.eduworkPreviewLinks.openExternal(${JSON.stringify(url)}); true`)
    await external
    assert.deepEqual(opened, [url])
    fs.writeFileSync(join(process.env.TEST_OUTPUT, 'result.json'), JSON.stringify({ passed: true, checks: ['sandboxed app preload forwards native link events', 'synthetic MP4 metadata decodes in the application renderer', 'explicit external request reaches native callback'], metadata }, null, 2))
    app.exit(0)
  } catch (error) {
    fs.writeFileSync(join(process.env.TEST_OUTPUT, 'result.json'), JSON.stringify({ passed: false, error: error.stack }))
    app.exit(1)
  } finally { window?.destroy(); fixture?.close() }
})
