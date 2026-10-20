// Decide whether the main BootPage should be brought to the front. A recovery
// or first-run download window is already the active startup surface, and a
// hidden or failed window must not be shown again.
export function shouldPresentMainWindow({ presented, startupFailure, quitting, recoveryActive, destroyed, startupWindowPresent, startupWindowHidden }) {
  return !presented && !startupFailure && !quitting && !recoveryActive && !destroyed && !startupWindowPresent && !startupWindowHidden
}

// A dedicated download/migration window can arrive before or after the main
// BootPage. If the main window is already visible, hand it over to the new
// window; if the user has hidden it, keep the new window hidden too.
export function startupWindowPresentation({ mainPresented, mainVisible }) {
  return {
    hideMain: mainPresented && mainVisible,
    showStartupWindow: !mainPresented || mainVisible,
  }
}

// When startup completes, return to the main window if the dedicated window is
// still visible and the main window is not. This covers both a main window we
// hid for the handoff and one the user had hidden before the dedicated window
// appeared and then actively restored from the Dock or tray.
export function startupWindowCompletion({ hadStartupWindow, mainHiddenForStartup, startupWindowHidden, mainPresented, mainVisible }) {
  return {
    startupWindowHidden,
    restoreMainWindow: Boolean(hadStartupWindow && !startupWindowHidden
      && (mainHiddenForStartup || (mainPresented && !mainVisible))),
  }
}
