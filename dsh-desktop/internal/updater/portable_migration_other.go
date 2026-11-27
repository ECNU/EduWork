//go:build !windows

package updater

import "errors"

func RunPortableMigration(_ []string) error {
	return errors.New("portable migration requires Windows")
}
