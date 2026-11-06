package main

import (
	"errors"
	"os/exec"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	jobObjectAssociateCompletionPortInformation = 7
	jobObjectMsgNewProcess                      = 6
	processCommandLineInformation               = 60
)

type unicodeString struct {
	Length        uint16
	MaximumLength uint16
	Buffer        *uint16
}

type jobAssociateCompletionPort struct {
	CompletionKey  uintptr
	CompletionPort windows.Handle
}

type jobBasicProcessIDList struct {
	NumberOfAssignedProcesses uint32
	NumberOfProcessIdsInList  uint32
	ProcessIdList             [1]uintptr
}

type jobBasicAccountingInformation struct {
	TotalUserTime             int64
	TotalKernelTime           int64
	ThisPeriodTotalUserTime   int64
	ThisPeriodTotalKernelTime int64
	TotalPageFaultCount       uint32
	TotalProcesses            uint32
	ActiveProcesses           uint32
	TotalTerminatedProcesses  uint32
}

type jobWatcher struct {
	port     windows.Handle
	stop     chan struct{}
	relaunch chan time.Time
}

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
	watcher, _ := watchJob(job)
	if watcher != nil {
		defer watcher.stopWatching()
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
	if waitErr != nil || watcher == nil {
		return waitErr
	}
	// Electron creates a --type=relauncher successor inside this job before the
	// old process exits. A clean exit must not kill that successor, but it must
	// still stop the Host and helpers that were running before the restart.
	var relaunchAt time.Time
	select {
	case relaunchAt = <-watcher.relaunch:
	case <-time.After(300 * time.Millisecond):
	}
	if relaunchAt.IsZero() {
		// No relaunch: keep the job limit active and let the deferred close
		// clean every descendant, as before.
		return waitErr
	}
	terminateOlderDescendants(job, relaunchAt)
	// Keep the job and its kill-on-close limit alive while the successor runs.
	// The updater monitors this launcher for health; exiting here would let it
	// roll back while the new desktop is still starting, and releasing the job
	// would let an old Host survive. Supervision ends when the job stays empty.
	superviseJob(job)
	return waitErr
}

func watchJob(job windows.Handle) (*jobWatcher, error) {
	port, err := windows.CreateIoCompletionPort(windows.InvalidHandle, 0, 0, 1)
	if err != nil {
		return nil, err
	}
	association := jobAssociateCompletionPort{CompletionKey: uintptr(job), CompletionPort: port}
	if _, err = windows.SetInformationJobObject(job, jobObjectAssociateCompletionPortInformation, uintptr(unsafe.Pointer(&association)), uint32(unsafe.Sizeof(association))); err != nil {
		windows.CloseHandle(port)
		return nil, err
	}
	watcher := &jobWatcher{port: port, stop: make(chan struct{}), relaunch: make(chan time.Time, 1)}
	go watcher.run()
	return watcher, nil
}

func (watcher *jobWatcher) stopWatching() {
	close(watcher.stop)
	windows.CloseHandle(watcher.port)
}

func (watcher *jobWatcher) run() {
	for {
		select {
		case <-watcher.stop:
			return
		default:
		}
		var message uint32
		var key uintptr
		var overlapped *windows.Overlapped
		if err := windows.GetQueuedCompletionStatus(watcher.port, &message, &key, &overlapped, 250); err != nil || message != jobObjectMsgNewProcess {
			continue
		}
		pid := uint32(uintptr(unsafe.Pointer(overlapped)))
		if at, ok := relauncherCreatedAt(pid); ok {
			select {
			case watcher.relaunch <- at:
			default:
			}
		}
	}
}

func relauncherCreatedAt(pid uint32) (time.Time, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return time.Time{}, false
	}
	defer windows.CloseHandle(handle)
	line, err := processCommandLine(handle)
	if err != nil || !strings.Contains(strings.ToLower(line), "--type=relauncher") {
		return time.Time{}, false
	}
	var creation, exit, kernel, user windows.Filetime
	if err = windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return time.Now(), true
	}
	return time.Unix(0, creation.Nanoseconds()), true
}

func processCommandLine(handle windows.Handle) (string, error) {
	var size uint32
	_ = windows.NtQueryInformationProcess(handle, processCommandLineInformation, nil, 0, &size)
	if size == 0 {
		return "", errors.New("command line is unavailable")
	}
	buffer := make([]byte, size)
	if err := windows.NtQueryInformationProcess(handle, processCommandLineInformation, unsafe.Pointer(&buffer[0]), size, &size); err != nil {
		return "", err
	}
	command := (*unicodeString)(unsafe.Pointer(&buffer[0]))
	start := uintptr(unsafe.Pointer(&buffer[0]))
	end := start + uintptr(len(buffer))
	pointer := uintptr(unsafe.Pointer(command.Buffer))
	if command.Length == 0 || pointer < start || pointer+uintptr(command.Length) > end {
		return "", errors.New("command line buffer is invalid")
	}
	return windows.UTF16ToString(unsafe.Slice(command.Buffer, int(command.Length)/2)), nil
}

func terminateOlderDescendants(job windows.Handle, relaunchAt time.Time) {
	for _, pid := range jobProcessIDs(job) {
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE, false, pid)
		if err != nil {
			continue
		}
		var creation, exit, kernel, user windows.Filetime
		if windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user) == nil {
			if time.Unix(0, creation.Nanoseconds()).Before(relaunchAt.Add(-10 * time.Millisecond)) {
				_ = windows.TerminateProcess(handle, 1)
			}
		}
		windows.CloseHandle(handle)
	}
}

func jobProcessIDs(job windows.Handle) []uint32 {
	const bufferSize = 8192
	buffer := make([]byte, bufferSize)
	if err := windows.QueryInformationJobObject(job, windows.JobObjectBasicProcessIdList, uintptr(unsafe.Pointer(&buffer[0])), bufferSize, nil); err != nil {
		return nil
	}
	list := (*jobBasicProcessIDList)(unsafe.Pointer(&buffer[0]))
	capacity := (bufferSize - int(unsafe.Offsetof(list.ProcessIdList))) / int(unsafe.Sizeof(uintptr(0)))
	count := int(list.NumberOfProcessIdsInList)
	if count > capacity {
		count = capacity
	}
	ids := unsafe.Slice(&list.ProcessIdList[0], count)
	pids := make([]uint32, 0, count)
	for _, id := range ids {
		pids = append(pids, uint32(id))
	}
	return pids
}

func jobActiveProcesses(job windows.Handle) (uint32, error) {
	var info jobBasicAccountingInformation
	err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil)
	return info.ActiveProcesses, err
}

func superviseJob(job windows.Handle) {
	var emptySince time.Time
	for {
		time.Sleep(250 * time.Millisecond)
		active, err := jobActiveProcesses(job)
		if err != nil {
			return
		}
		if active > 0 {
			emptySince = time.Time{}
			continue
		}
		if emptySince.IsZero() {
			emptySince = time.Now()
			continue
		}
		if time.Since(emptySince) >= 2*time.Second {
			return
		}
	}
}
