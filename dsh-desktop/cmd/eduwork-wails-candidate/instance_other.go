//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

func acquireHomeLock(home string) (func(), error) {
	id, err := homeLockID(home)
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(os.TempDir(), "eduwork-home-"+id+".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("this EduWork data directory is already open in another window")
	}
	var once sync.Once
	return func() { once.Do(func() { _ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN); file.Close() }) }, nil
}
