//go:build !windows

package portable

import (
	"context"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
)

func checkNotRunning(target string) error { return nil }

func StopApplication(target string) error {
	release, err := installguard.Acquire(target)
	if err != nil {
		return err
	}
	defer release()
	return installguard.CheckUpdateIdle(target)
}

func stopApplication(ctx context.Context, target string) error {
	return installguard.CheckUpdateIdle(target)
}

func acquireInstallationLock(target string) (func(), error) { return installguard.Acquire(target) }
