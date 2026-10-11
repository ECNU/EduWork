//go:build !windows

package portable

func checkNotRunning(target string) error { return nil }

func StopApplication(target string) error { return nil }

func acquireInstallationLock(target string) (func(), error) { return func() {}, nil }
