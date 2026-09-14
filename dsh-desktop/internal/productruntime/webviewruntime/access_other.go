//go:build !windows

package webviewruntime

func EnsureReadAccess(string) error { return nil }
