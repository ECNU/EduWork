// Decide whether the main BootPage should be brought to the front. A recovery
// or first-run download window is already the active startup surface, and a
// hidden or failed window must not be shown again.
export function shouldPresentMainWindow({ presented, startupFailure, quitting, recoveryActive, destroyed, startupWindowPresent, startupWindowHidden }) {
  return !presented && !startupFailure && !quitting && !recoveryActive && !destroyed && !startupWindowPresent && !startupWindowHidden
}
