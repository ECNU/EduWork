package portable

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"strings"
	"unsafe"
)

func applicationProcesses(target string, stop bool) (bool, error) {
	found := false
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		if entry.ProcessID == uint32(os.Getpid()) {
			continue
		}
		rights := uint32(windows.PROCESS_QUERY_LIMITED_INFORMATION)
		if stop {
			rights |= windows.PROCESS_TERMINATE | windows.SYNCHRONIZE
		}
		process, e := windows.OpenProcess(rights, false, entry.ProcessID)
		if e != nil {
			continue
		}
		buf := make([]uint16, 32768)
		size := uint32(len(buf))
		e = windows.QueryFullProcessImageName(process, 0, &buf[0], &size)
		if e == nil {
			path := windows.UTF16ToString(buf[:size])
			if strings.HasPrefix(strings.ToLower(filepath.Clean(path)), strings.ToLower(filepath.Clean(target))+string(filepath.Separator)) {
				found = true
				if stop {
					e = windows.TerminateProcess(process, 0)
					if e == nil {
						_, e = windows.WaitForSingleObject(process, 5000)
					}
					if e != nil {
						windows.CloseHandle(process)
						return true, fmt.Errorf("无法结束 EduWork 进程，请手动退出后重试：%w", e)
					}
				}
			}
		}
		windows.CloseHandle(process)
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return found, err
	}
	return found, nil
}
func checkNotRunning(target string) error {
	found, err := applicationProcesses(target, false)
	if err != nil {
		return err
	}
	if found {
		return errors.New("EduWork 或其后台进程正在运行，请关闭后继续安装")
	}
	return nil
}

// StopApplication is called only after the installer obtains explicit consent.
func StopApplication(target string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	for i := 0; i < 3; i++ {
		found, err := applicationProcesses(target, true)
		if err != nil {
			return err
		}
		if !found {
			return nil
		}
	}
	return checkNotRunning(target)
}

func acquireInstallationLock(target string) (func(), error) {
	key := fmt.Sprintf("Local\\EduWorkInstall-%x", sha256.Sum256([]byte(strings.ToLower(filepath.Clean(target)))))
	name, _ := windows.UTF16PtrFromString(key)
	h, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		if h != 0 {
			windows.CloseHandle(h)
		}
		return nil, errors.New("此目录已有安装任务，请等待该任务结束后重试")
	}
	return func() { windows.CloseHandle(h) }, nil
}
