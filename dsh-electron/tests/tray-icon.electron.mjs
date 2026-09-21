// Run with Electron on macOS: electron dsh-electron/tests/tray-icon.electron.mjs
import { app, nativeImage, Tray } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../../', import.meta.url))
app.whenReady().then(() => {
  try {
    assert.equal(process.platform, 'darwin', 'Run this native template check on macOS')
    const source = readFileSync(join(root, 'dsh-electron/src/product.mjs'), 'utf8')
    const trayBlock = source.slice(source.indexOf('export async function attachDesktopWindow'))
    const start = trayBlock.indexOf('    const icon =')
    const end = trayBlock.indexOf('    lifecycle.check()', start)
    assert.ok(start >= 0 && end > start)
    // Execute the production icon setup against real Electron images, without starting the Host.
    for (const platform of ['darwin', 'win32']) {
      const icon = runInNewContext(trayBlock.slice(start, end) + '\nicon', {
        nativeImage, readFileSync, process: { platform },
        app: { getAppPath: () => join(root, 'assets/app') }, paths: { root },
        join: (...parts) => {
          const path = join(...parts)
          return path.replace(join(root, 'assets/brand'), join(root, 'assets/eduwork'))
            .replace(join(root, 'resources/brand'), join(root, 'assets/eduwork'))
        },
      })
      assert.equal(icon.isEmpty(), false)
      assert.equal(icon.isTemplateImage(), platform === 'darwin')
      assert.deepEqual(icon.getSize(), platform === 'darwin' ? { width: 16, height: 16 } : { width: 32, height: 32 })
      if (platform === 'darwin') {
        assert.ok(icon.getScaleFactors().includes(2))
        const pixels = icon.toBitmap({ scaleFactor: 2 })
        assert.ok(pixels.some((value, index) => index % 4 === 3 && value === 0), 'Transparent background')
        assert.ok(pixels.some((value, index) => index % 4 === 3 && value === 255), 'Visible mark')
        const tray = new Tray(icon)
        tray.destroy()
      }
    }
    const packaging = readFileSync(join(root, 'dsh-electron/scripts/assemble-macos.ps1'), 'utf8')
    const assets = packaging.match(/foreach \(\$asset in @\(([^)]+)\)\)/)[1]
    assert.ok(assets.includes("'tray-black.png'"), 'The Mac package includes the template asset')
    console.log(`PASS: macOS 16pt / 2x template, transparent mark, native Tray, Windows image, package asset (Electron ${process.versions.electron})`)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
  app.quit()
})
