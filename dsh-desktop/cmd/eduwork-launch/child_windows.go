package main

import (
	"errors"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The owned Electron shell requests a restart after its normal will-quit cleanup.
// Code 24 additionally retires the completed updater's one-time arguments.
const (
	restartExitCode        = 23
	updatedRestartExitCode = 24
)

func runChild(child *exec.Cmd) error {
	child.Env = append(child.Environ(), "EDUWORK_LAUNCHER_RESTART=1")
	for {
		err := runChildJob(child)
		var exited *exec.ExitError
		if !errors.As(err, &exited) || (exited.ExitCode() != restartExitCode && exited.ExitCode() != updatedRestartExitCode) {
			return err
		}
		args := child.Args[1:]
		if exited.ExitCode() == updatedRestartExitCode {
			args = withoutUpdateHandshake(args)
		}
		next := exec.Command(child.Path, args...)
		next.Dir, next.Env = child.Dir, child.Env
		next.Stdin, next.Stdout, next.Stderr = child.Stdin, child.Stdout, child.Stderr
		next.SysProcAttr = child.SysProcAttr
		child = next
	}
}

func withoutUpdateHandshake(args []string) []string {
	retained := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		if args[index] == "--update-health-file" || args[index] == "--eduwork-migration" {
			index++
		} else {
			retained = append(retained, args[index])
		}
	}
	return retained
}

// Each desktop gets its own Job. Closing it cleans the old Host/helpers before
// a requested restart. Killing the launcher still kills the desktop, while an
// explicitly breakaway updater can finish its installation.
func runChildJob(child *exec.Cmd) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return err
	}
	if err = child.Start(); err != nil {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(child.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(job, process)
		windows.CloseHandle(process)
	}
	if err != nil {
		_ = child.Process.Kill()
		_ = child.Wait()
		return err
	}
	return child.Wait()
}
