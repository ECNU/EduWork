//go:build windows

package main

import (
	"errors"
	"golang.org/x/sys/windows"
	"sync"
)

func acquireHomeLock(home string) (func(), error) {
	id, err := homeLockID(home)
	if err != nil {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString("Global\\EduWork-Desktop-Home-" + id)
	if err != nil {
		return nil, err
	}
	// The named object itself is the lease; no OS-thread-bound mutex ownership
	// is needed. Its last handle closes automatically even after a process crash.
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		if handle != 0 {
			windows.CloseHandle(handle)
		}
		if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			return nil, errors.New("this EduWork data directory is already open in another window")
		}
		return nil, err
	}
	var once sync.Once
	return func() { once.Do(func() { windows.CloseHandle(handle) }) }, nil
}
