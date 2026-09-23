/** Apply the same brand to the shell and portable Windows notification sender. */
export function applyDesktopBrand(app, platform, { productName, appId }) {
  app.setName(productName)
  // Without an installed shortcut, Windows displays the process AUMID as the
  // tray balloon's sender. Use the brand, not the internal bundle identifier;
  // this needs no registry or Start menu registration. AUMIDs cannot have spaces
  // and are limited to 128 characters. Other platform identities stay intact.
  const windowsId = productName.replace(/\s/gu, '').slice(0, 128)
  app.setAppUserModelId(platform === 'win32' ? windowsId || appId : appId)
}
