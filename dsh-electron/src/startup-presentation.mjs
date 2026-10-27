// Hiding the application before its first window must also survive Host readiness.
export function shouldPresentMainWindow({ presented, appHidden, startupFailure, quitting, recoveryActive, destroyed, startupWindowPresent }) {
  return !presented && !appHidden && !startupFailure && !quitting && !recoveryActive && !destroyed && !startupWindowPresent
}
