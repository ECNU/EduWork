//go:build !windows

package updater

func updateInstalledRegistrationVersion(string, string) error { return nil }
