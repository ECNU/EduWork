package main

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// An old updater kills only its directly launched process when health fails.
// Keep the real desktop in this launcher's job so rollback cannot leave a
// window running against removed program files. Explicit update helpers may
// break away because they must survive the desktop's normal shutdown.
func runChild(child *exec.Cmd) error {
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
	waitErr := child.Wait()
	// Abnormal exits keep the kill-on-close limit so a crash or updater
	// termination cannot leave a stale process tree.
	if waitErr != nil {
		return waitErr
	}
	// Electron relaunches by creating its successor inside this job before the
	// old process exits. A clean exit must not kill that successor. The
	// kill-on-close limit stays active when this launcher itself is terminated:
	// the updater rollback path never reaches this clear, so the OS still closes
	// the job and stops the old process tree.
	normal := info
	normal.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&normal)), uint32(unsafe.Sizeof(normal))); err != nil {
		return err
	}
	return waitErr
}
