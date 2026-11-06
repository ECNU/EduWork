package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	jobObjectAssociateCompletionPortInformation = 7
	jobObjectMsgNewProcess                      = 6
	processBasicInformationClass                = 0
	processCommandLineInformation               = 60
)

const (
	relaunchSettleTime = 500 * time.Millisecond
	relaunchWaitLimit  = 2 * time.Second
	processPollPeriod  = 50 * time.Millisecond
)

var (
	// Tests and field diagnostics may redirect this file; normal runs use a
	// per-user temporary log so a degraded launcher is never silent.
	launcherLogPath = func() string {
		if path := os.Getenv("EDUWORK_LAUNCHER_LOG"); path != "" {
			return path
		}
		return filepath.Join(os.TempDir(), "EduWork-launcher.log")
	}
	createJobWatcher = func(job windows.Handle, ledger *processLedger) (*jobObserver, error) {
		if os.Getenv("EDUWORK_JOB_WATCH_FAIL") == "1" {
			return nil, errors.New("synthetic watcher initialization failure")
		}
		return watchJob(job, ledger)
	}
)

func reportLauncherIssue(message string) {
	file, err := os.OpenFile(launcherLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = fmt.Fprintf(file, "%s %s\n", time.Now().Format(time.RFC3339), message)
}

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

type processBasicInformation struct {
	ExitStatus                   uint32
	PebBaseAddress               uintptr
	AffinityMask                 uintptr
	BasePriority                 int32
	UniqueProcessID              uintptr
	InheritedFromUniqueProcessID uintptr
}

type processStatus int

const (
	processUnknown processStatus = iota
	processOther
	processRelauncher
)

type processEntry struct {
	status  processStatus
	created time.Time
}

type processLedger struct {
	mutex   sync.Mutex
	entries map[uint32]processEntry
}

func newProcessLedger() *processLedger {
	return &processLedger{entries: make(map[uint32]processEntry)}
}

func (ledger *processLedger) status(pid uint32) (processEntry, bool) {
	ledger.mutex.Lock()
	defer ledger.mutex.Unlock()
	entry, ok := ledger.entries[pid]
	return entry, ok
}

func (ledger *processLedger) mark(pid uint32, status processStatus, created time.Time) {
	ledger.mutex.Lock()
	defer ledger.mutex.Unlock()
	ledger.entries[pid] = processEntry{status: status, created: created}
}

// observe reads a process once. A process that exits before its command line
// can be read stays unknown and is never used as a relauncher identity.
func (ledger *processLedger) observe(pid uint32) {
	if _, ok := ledger.status(pid); ok {
		return
	}
	entry := processEntry{status: processUnknown}
	if handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); err == nil {
		var creation, exit, kernel, user windows.Filetime
		if windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user) == nil {
			entry.created = time.Unix(0, creation.Nanoseconds())
		}
		if line, err := processCommandLine(handle); err == nil {
			if strings.Contains(strings.ToLower(line), "--type=relauncher") {
				entry.status = processRelauncher
			} else {
				entry.status = processOther
			}
		}
		windows.CloseHandle(handle)
	}
	ledger.mutex.Lock()
	if _, exists := ledger.entries[pid]; !exists {
		ledger.entries[pid] = entry
	}
	ledger.mutex.Unlock()
}

type jobObserver struct {
	port windows.Handle
	stop chan struct{}
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
	ledger := newProcessLedger()
	observer, watchErr := createJobWatcher(job, ledger)
	if watchErr != nil {
		reportLauncherIssue("job watcher unavailable: " + watchErr.Error() + "; polling descendants")
	}
	if observer == nil {
		observer = watchJobPolling(job, ledger)
	}
	defer observer.stopWatching()
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
	mainProcess, _ := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(child.Process.Pid))
	waitErr := child.Wait()
	mainExit := time.Time{}
	if mainProcess != 0 {
		var creation, exit, kernel, user windows.Filetime
		if windows.GetProcessTimes(mainProcess, &creation, &exit, &kernel, &user) == nil {
			mainExit = time.Unix(0, exit.Nanoseconds())
		}
		windows.CloseHandle(mainProcess)
	}
	// Abnormal exits keep the kill-on-close limit so a crash or updater
	// termination cannot leave a stale process tree.
	if waitErr != nil {
		return waitErr
	}
	// A live --type=relauncher, or its child created after the desktop exit,
	// is the only verified relaunch. Notification events are hints for the
	// ledger; the decision below always inspects the settled job itself.
	relaunchAt, found := waitForRelaunch(job, ledger, mainExit)
	if !found {
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

func watchJob(job windows.Handle, ledger *processLedger) (*jobObserver, error) {
	port, err := windows.CreateIoCompletionPort(windows.InvalidHandle, 0, 0, 1)
	if err != nil {
		return nil, err
	}
	association := jobAssociateCompletionPort{CompletionKey: uintptr(job), CompletionPort: port}
	if _, err = windows.SetInformationJobObject(job, jobObjectAssociateCompletionPortInformation, uintptr(unsafe.Pointer(&association)), uint32(unsafe.Sizeof(association))); err != nil {
		windows.CloseHandle(port)
		return nil, err
	}
	observer := &jobObserver{port: port, stop: make(chan struct{})}
	go observer.runEvents(ledger)
	go observer.poll(job, ledger)
	return observer, nil
}

func watchJobPolling(job windows.Handle, ledger *processLedger) *jobObserver {
	observer := &jobObserver{stop: make(chan struct{})}
	go observer.poll(job, ledger)
	return observer
}

func (observer *jobObserver) stopWatching() {
	close(observer.stop)
	if observer.port != 0 {
		windows.CloseHandle(observer.port)
	}
}

func (observer *jobObserver) runEvents(ledger *processLedger) {
	for {
		select {
		case <-observer.stop:
			return
		default:
		}
		var message uint32
		var key uintptr
		var overlapped *windows.Overlapped
		if err := windows.GetQueuedCompletionStatus(observer.port, &message, &key, &overlapped, 250); err != nil {
			continue
		}
		if message == jobObjectMsgNewProcess {
			ledger.observe(uint32(uintptr(unsafe.Pointer(overlapped))))
		}
	}
}

func (observer *jobObserver) poll(job windows.Handle, ledger *processLedger) {
	ticker := time.NewTicker(processPollPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-observer.stop:
			return
		case <-ticker.C:
			observeJob(job, ledger)
		}
	}
}

func observeJob(job windows.Handle, ledger *processLedger) {
	for _, pid := range jobProcessIDs(job) {
		ledger.observe(pid)
	}
}

func waitForRelaunch(job windows.Handle, ledger *processLedger, mainExit time.Time) (time.Time, bool) {
	started := time.Now()
	lastSignature := ""
	stableSince := started
	for {
		observeJob(job, ledger)
		if at, ok := findVerifiedRelaunch(job, ledger, mainExit); ok {
			return at, true
		}
		signature := jobSignature(job)
		now := time.Now()
		if signature != lastSignature {
			lastSignature = signature
			stableSince = now
		} else if now.Sub(started) >= relaunchSettleTime && now.Sub(stableSince) >= relaunchSettleTime {
			return time.Time{}, false
		}
		if now.Sub(started) >= relaunchWaitLimit {
			return time.Time{}, false
		}
		time.Sleep(processPollPeriod)
	}
}

func findVerifiedRelaunch(job windows.Handle, ledger *processLedger, mainExit time.Time) (time.Time, bool) {
	for _, pid := range jobProcessIDs(job) {
		if entry, ok := ledger.status(pid); ok && entry.status == processRelauncher {
			return entry.created, true
		}
		if at, ok := relauncherCreatedAt(pid); ok {
			ledger.mark(pid, processRelauncher, at)
			return at, true
		}
		parent, ok := processParent(pid)
		if !ok {
			continue
		}
		parentEntry, ok := ledger.status(parent)
		if !ok || parentEntry.status != processRelauncher || mainExit.IsZero() {
			continue
		}
		if created, ok := processCreated(pid); ok && created.After(mainExit) {
			return mainExit, true
		}
	}
	return time.Time{}, false
}

func jobSignature(job windows.Handle) string {
	pids := jobProcessIDs(job)
	values := make([]string, 0, len(pids))
	for _, pid := range pids {
		values = append(values, strconv.FormatUint(uint64(pid), 10))
	}
	sort.Strings(values)
	return strings.Join(values, ",")
}

func processParent(pid uint32) (uint32, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, false
	}
	defer windows.CloseHandle(handle)
	var info processBasicInformation
	var size uint32
	if err := windows.NtQueryInformationProcess(handle, processBasicInformationClass, unsafe.Pointer(&info), uint32(unsafe.Sizeof(info)), &size); err != nil {
		return 0, false
	}
	return uint32(info.InheritedFromUniqueProcessID), true
}

func processCreated(pid uint32) (time.Time, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return time.Time{}, false
	}
	defer windows.CloseHandle(handle)
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return time.Time{}, false
	}
	return time.Unix(0, creation.Nanoseconds()), true
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
