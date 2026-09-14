//go:build !windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func stopUpdatedProcess(command *exec.Cmd) error {
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil && err != syscall.ESRCH {
		return err
	}
	_, _ = command.Process.Wait()
	return nil
}

func configureDetachedHelperCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

func configureDetachedAppCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

func waitForProcessExit(pid int, timeout time.Duration) error {
	if pid <= 0 {
		return nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := process.Signal(syscall.Signal(0)); err != nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("desktop process %d did not exit before update timeout", pid)
}

func processExited(command *exec.Cmd) bool {
	if command == nil || command.Process == nil {
		return true
	}
	return command.Process.Signal(syscall.Signal(0)) != nil
}
