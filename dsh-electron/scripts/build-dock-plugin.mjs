// Run before signing: node build-dock-plugin.mjs <assembled app>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin' || !process.argv[2]) throw new Error('A macOS app path is required')
const app = resolve(process.argv[2])
const settings = JSON.parse(readFileSync(join(app, 'Contents/Resources/app/eduwork.desktop.json'), 'utf8'))
if (!/^[a-z0-9.-]+$/.test(settings.appId) || !/^[a-z0-9-]+$/.test(settings.distribution)) throw new Error('Invalid Dock plugin identity')
const appPlist = join(app, 'Contents/Info.plist')
const identifier = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', appPlist], { encoding: 'utf8' }).trim()
if (identifier !== settings.appId) throw new Error('Dock plugin and application identities differ')
const name = 'EduWorkDockTilePlugin'
const principalClass = name + '_' + identifier.replace(/[.-]/g, '_')
const contents = join(app, 'Contents/PlugIns', name + '.docktileplugin', 'Contents')
mkdirSync(join(contents, 'MacOS'), { recursive: true })
execFileSync('xcrun', ['clang', '-fobjc-arc', '-bundle', '-framework', 'AppKit', '-mmacosx-version-min=15.0',
  '-D' + 'EDUWORK_DOCK_CLASS=' + principalClass, fileURLToPath(new URL('../native/dock-tile-plugin.m', import.meta.url)),
  '-o', join(contents, 'MacOS', name)], { stdio: 'inherit' })
const plist = join(contents, 'Info.plist')
writeFileSync(plist, JSON.stringify({ CFBundleIdentifier: identifier + '.docktile', CFBundleExecutable: name,
  CFBundlePackageType: 'BNDL', CFBundleVersion: '1', NSPrincipalClass: principalClass, EduWorkDistribution: settings.distribution }))
execFileSync('plutil', ['-convert', 'xml1', plist])
execFileSync('plutil', ['-replace', 'NSDockTilePlugIn', '-string', name + '.docktileplugin', appPlist])
console.log('Built Dock tile plugin: ' + identifier)
