package portable

import (
	"context"
	"errors"
	"fmt"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type applicationProcess struct {
	pid   uint32
	image string
}

func processImage(process windows.Handle) (string, error) {
	buf := make([]uint16, 32768)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(process, 0, &buf[0], &size); err != nil {
		return "", err
	}
	// QueryFullProcessImageName can retain an 8.3 launch spelling, while the
	// installation path resolves to its long spelling (notably on CI runners).
	return filepath.EvalSymlinks(windows.UTF16ToString(buf[:size]))
}

// Classify the entire snapshot before closing any process. Helpers are never
// ordinary clients, including when an older helper left no pending receipt.
func applicationProcessList(target string) ([]applicationProcess, error) {
	target, err := filepath.EvalSymlinks(target)
	if err != nil {
		return nil, err
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	var processes []applicationProcess
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		if entry.ProcessID == uint32(os.Getpid()) {
			continue
		}
		process, e := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, entry.ProcessID)
		if e != nil {
			continue
		}
		image, e := processImage(process)
		windows.CloseHandle(process)
		if e != nil {
			continue
		}
		relative, e := filepath.Rel(target, image)
		if e != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			continue
		}
		relative = strings.ToLower(filepath.ToSlash(relative))
		if strings.HasPrefix(relative, "data/state/updates/helper/") {
			return nil, installguard.ErrUpdateActive
		}
		if privatePath(relative) {
			continue
		}
		processes = append(processes, applicationProcess{entry.ProcessID, image})
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	return processes, nil
}

func applicationProcesses(target string, stop bool) (bool, error) {
	if err := installguard.CheckUpdateIdle(target); err != nil {
		return false, err
	}
	processes, err := applicationProcessList(target)
	if err != nil {
		return false, err
	}
	if stop {
		for _, candidate := range processes {
			// Older clients can launch an uncoordinated helper while closing.
			if err := installguard.CheckUpdateIdle(target); err != nil {
				return true, err
			}
			if _, err := applicationProcessList(target); err != nil {
				return true, err
			}
			process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, candidate.pid)
			if err != nil {
				continue
			}
			image, err := processImage(process)
			if err == nil && strings.EqualFold(image, candidate.image) {
				err = windows.TerminateProcess(process, 0)
				if err == nil {
					var state uint32
					state, err = windows.WaitForSingleObject(process, 5000)
					if err == nil && state == uint32(windows.WAIT_TIMEOUT) {
						err = errors.New("等待进程退出超时")
					}
				}
				if err != nil {
					windows.CloseHandle(process)
					return true, fmt.Errorf("无法结束 EduWork 进程，请手动退出后重试：%w", err)
				}
			}
			windows.CloseHandle(process)
		}
	}
	return len(processes) > 0, nil
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

func requestApplicationClose(processes []applicationProcess) int {
	pids := map[uint32]bool{}
	for _, process := range processes {
		pids[process.pid] = true
	}
	user := windows.NewLazySystemDLL("user32.dll")
	posted := 0
	callback := syscall.NewCallback(func(window, _ uintptr) uintptr {
		var pid uint32
		user.NewProc("GetWindowThreadProcessId").Call(window, uintptr(unsafe.Pointer(&pid)))
		if pids[pid] {
			if ok, _, _ := user.NewProc("PostMessageW").Call(window, 0x10, 0, 0); ok != 0 {
				posted++
			}
		}
		return 1
	})
	user.NewProc("EnumWindows").Call(callback, 0)
	return posted
}

func stopApplication(ctx context.Context, target string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := installguard.CheckUpdateIdle(target); err != nil {
		return err
	}
	processes, err := applicationProcessList(target)
	if err != nil {
		return err
	}
	if requestApplicationClose(processes) > 0 {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if err := ctx.Err(); err != nil {
				return err
			}
			found, err := applicationProcesses(target, false)
			if err != nil {
				return err
			}
			if !found {
				return nil
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	for i := 0; i < 3; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
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

// StopApplication is called only after explicit consent. Prefer a normal window
// close, then force remaining clients; never close or terminate an updater.
func StopApplication(target string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	release, err := acquireInstallationLock(target)
	if err != nil {
		return err
	}
	defer release()
	return stopApplication(context.Background(), target)
}

func acquireInstallationLock(target string) (func(), error) { return installguard.Acquire(target) }
