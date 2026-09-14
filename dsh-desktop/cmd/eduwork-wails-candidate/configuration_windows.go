//go:build windows

package main

import (
	"golang.org/x/sys/windows"
)

func openConfigurationPath(path string, textFile bool) error {
	file, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	// A nil verb selects the OS default, including its application chooser.
	return windows.ShellExecute(0, nil, file, nil, nil, windows.SW_SHOWNORMAL)
}
