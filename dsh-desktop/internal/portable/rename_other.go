//go:build !windows

package portable

func transientRenameError(err error) bool { return false }
