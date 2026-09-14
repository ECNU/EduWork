//go:build !windows

package desktoptransport

import (
	"os/exec"
	"sync"
	"syscall"
)

func configureProcess(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func containProcess(command *exec.Cmd) (func(), error) {
	var once sync.Once
	return func() { once.Do(func() { _ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL) }) }, nil
}
