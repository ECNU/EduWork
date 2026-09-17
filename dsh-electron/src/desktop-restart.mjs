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
