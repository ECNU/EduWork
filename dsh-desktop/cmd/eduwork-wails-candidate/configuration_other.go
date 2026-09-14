//go:build !windows

package main

import "errors"

func openConfigurationPath(string, bool) error {
	return errors.New("configuration opening is not implemented on this platform")
}
