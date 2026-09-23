let revealMainWindow = () => {}
let macDockActivateBound = false
export function bindMacDockActivate(application, show, platform = process.platform) {
  if (platform !== 'darwin') return
  revealMainWindow = show
  if (macDockActivateBound) return
  macDockActivateBound = true
  application.on('activate', () => { revealMainWindow() })
}
