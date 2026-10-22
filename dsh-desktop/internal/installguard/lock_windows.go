package installguard

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/sys/windows"
)

func acquire(target string) (func(), error) {
	// The object's existence is the lease, not thread-bound mutex ownership.
	// Global also coordinates two Windows sessions using the same installation.
	key := fmt.Sprintf("Global\\EduWorkInstall-%x", sha256.Sum256([]byte(strings.ToLower(target))))
	name, err := windows.UTF16PtrFromString(key)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		if handle != 0 {
			windows.CloseHandle(handle)
		}
		return nil, fmt.Errorf("%w：%v", ErrBusy, err)
	}
	var once sync.Once
	return func() { once.Do(func() { windows.CloseHandle(handle) }) }, nil
}
