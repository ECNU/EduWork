// A window hidden after its first presentation must stay hidden at Host readiness.
export function shouldPresentMainWindow({ presented, startupFailure, quitting, recoveryActive, destroyed, startupWindowPresent }) {
  return !presented && !startupFailure && !quitting && !recoveryActive && !destroyed && !startupWindowPresent
}
