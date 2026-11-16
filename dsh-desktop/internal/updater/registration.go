package updater

import (
	"path/filepath"
	"strings"
)

// registrationLocationMatches compares the uninstall entry's InstallLocation
// with the directory being updated. Registered per-user installs record the
// program root there; portable roots never match an installed registration.
func registrationLocationMatches(location, installDir string) bool {
	trim := func(value string) string { return strings.TrimRight(filepath.Clean(value), `\/`) }
	if strings.TrimSpace(location) == "" || strings.TrimSpace(installDir) == "" {
		return false
	}
	return strings.EqualFold(trim(location), trim(installDir))
}
