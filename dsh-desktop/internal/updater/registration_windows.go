//go:build windows

package updater

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

const uninstallRegistryRoot = `Software\Microsoft\Windows\CurrentVersion\Uninstall`

// updateInstalledRegistrationVersion keeps the Windows uninstall entry's
// DisplayVersion in step with a successful file update. The NSIS uninstaller
// and its registration stay untouched; only the reported version changes.
// Portable roots have no matching InstallLocation, so this is a no-op there.
func updateInstalledRegistrationVersion(installDir, version string) error {
	root, err := registry.OpenKey(registry.CURRENT_USER, uninstallRegistryRoot, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	defer root.Close()
	names, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return err
	}
	for _, name := range names {
		key, err := registry.OpenKey(registry.CURRENT_USER, uninstallRegistryRoot+`\`+name, registry.QUERY_VALUE|registry.SET_VALUE)
		if err != nil {
			continue
		}
		location, _, err := key.GetStringValue("InstallLocation")
		if err != nil || !registrationLocationMatches(location, installDir) {
			key.Close()
			continue
		}
		if err := key.SetStringValue("DisplayVersion", version); err != nil {
			key.Close()
			return err
		}
		key.Close()
		return nil
	}
	return nil
}
