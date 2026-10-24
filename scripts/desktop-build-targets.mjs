import { isMainModule } from './lib/build-util.mjs'

// Keep the existing ARM artifact identity for release/edition consumers.
// Intel uses the same macOS scripts, with a separate native runner and artifact.
export function desktopBuildTargets(selection = 'both', mode = 'node') {
  if (!['node', 'ps1'].includes(mode)) throw new Error('Unknown desktop build mode')
  if (!['both', 'windows', 'macos', 'macos-arm64', 'macos-x64'].includes(selection)) throw new Error('Unknown desktop target')
  if (mode === 'ps1' && selection === 'macos-x64') throw new Error('Intel Mac requires the Node build recipe')
  const targets = [
    { platform: 'windows', script: 'windows', runner: 'windows-latest' },
    { platform: 'macos', script: 'macos', runner: 'macos-26', compatibilityRunner: 'macos-15' },
    ...(mode === 'node' ? [{ platform: 'macos-x64', script: 'macos', runner: 'macos-26-intel', compatibilityRunner: 'macos-15-intel' }] : []),
  ]
  return targets.filter(target => selection === 'both'
    || (selection === 'macos' && target.script === 'macos')
    || target.platform === (selection === 'macos-arm64' ? 'macos' : selection))
}

if (isMainModule(import.meta.url)) console.log(JSON.stringify(desktopBuildTargets(...process.argv.slice(2))))
