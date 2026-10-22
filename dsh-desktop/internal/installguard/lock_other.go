//go:build !windows

package installguard

import (
	"fmt"
	"os"
	"sync"

	"golang.org/x/sys/unix"
)

func acquire(target string) (func(), error) {
	// Existing installation directories provide a stable inode without a stale
	// lock file. The kernel releases the lease if the owning process exits.
	f, err := os.Open(target)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("%w：%v", ErrBusy, err)
	}
	var once sync.Once
	return func() { once.Do(func() { f.Close() }) }, nil
}
