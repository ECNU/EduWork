// Electron reuses the original command line unless args are supplied. The
// installer deletes its transaction after observing health.ok, so subsequent
// in-app restarts must not repeat that completed, one-time handshake.
export function desktopRelaunchOptions(args, updateCompleted = false) {
  if (!updateCompleted) return { args: [...args] }
  const retained = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--update-health-file' || args[index] === '--eduwork-migration') {
      // Validated by readMigrationLaunch before desktopReady acknowledges it.
      index++
    } else {
      retained.push(args[index])
    }
  }
  return { args: retained }
}

// The legacy Windows launcher owns the shell's Job, so it must start the next
// shell after closing the old Job. Direct Electron launches use native relaunch.
export function configureDesktopRelaunch(app, launcherOwned) {
  if (!launcherOwned) return (args, updated) => app.relaunch(desktopRelaunchOptions(args, updated))
  let restartCode
  app.on('will-quit', event => {
    if (restartCode === undefined) return
    event.preventDefault()
    // app.exit skips quit events: let all will-quit cleanup listeners run first.
    setImmediate(() => app.exit(restartCode))
  })
  return (_args, updated = false) => { restartCode = updated ? 24 : 23 }
}
