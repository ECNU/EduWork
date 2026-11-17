//go:build windows

package updater

import (
	"errors"

	"golang.org/x/sys/windows"
)

// Windows reports a cross-volume rename as ERROR_NOT_SAME_DEVICE. syscall.EXDEV
// is an unrelated invented errno on Windows, so it must not be used here.
func isCrossDeviceError(err error) bool {
	return errors.Is(err, windows.ERROR_NOT_SAME_DEVICE)
}
