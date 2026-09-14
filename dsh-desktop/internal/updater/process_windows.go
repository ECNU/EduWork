//go:build windows

package updater

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// The newly launched desktop may already own Node and Chromium children.
// Releasing only its main process leaves those children holding files which
// rollback needs to replace. Restrict termination to this owned process tree.
func stopUpdatedProcess(command *exec.Cmd) error {
	if !processExited(command) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		stop := exec.CommandContext(ctx, "taskkill.exe", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F")
		stop.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := stop.Run(); err != nil && !processExited(command) {
			return fmt.Errorf("stop failed update process tree: %w", err)
		}
	}
	_, _ = command.Process.Wait()
	return nil
}

func configureDetachedHelperCommand(command *exec.Cmd) {
	// The helper owns the product-branded update progress window. Keep it in a
	// separate process group so it can outlive the old desktop, but do not hide
	// it: both immediate and next-start installs must make their work visible.
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_BREAKAWAY_FROM_JOB}
}

func configureDetachedAppCommand(command *exec.Cmd) {
	// The restarted Wails desktop must not inherit STARTF_USESHOWWINDOW/SW_HIDE.
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
}

func waitForProcessExit(pid int, timeout time.Duration) error {
	if pid <= 0 {
		return nil
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		if err == windows.ERROR_INVALID_PARAMETER {
			return nil
		}
		return err
	}
	defer windows.CloseHandle(handle)
	result, err := windows.WaitForSingleObject(handle, uint32(timeout/time.Millisecond))
	if err != nil {
		return err
	}
	if result == uint32(windows.WAIT_TIMEOUT) {
		return fmt.Errorf("desktop process %d did not exit before update timeout", pid)
	}
	return nil
}

func processExited(command *exec.Cmd) bool {
	if command == nil || command.Process == nil {
		return true
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(command.Process.Pid))
	if err != nil {
		return true
	}
	defer windows.CloseHandle(handle)
	var code uint32
	if err := windows.GetExitCodeProcess(handle, &code); err != nil {
		return true
	}
	// STILL_ACTIVE is the Win32 process status value returned while a process
	// is running. x/sys/windows does not expose the constant in every pinned
	// version, so keep the stable ABI value local.
	const stillActive = 259
	return code != stillActive
}
