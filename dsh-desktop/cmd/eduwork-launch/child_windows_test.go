package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestLauncherJobHelper(t *testing.T) {
	role := os.Getenv("EDUWORK_JOB_TEST")
	if role == "" {
		return
	}
	if role == "launcher" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestLauncherJobHelper$")
		cmd.Env = append(os.Environ(), "EDUWORK_JOB_TEST=desktop")
		if err := runChild(cmd); err != nil {
			os.Exit(2)
		}
		os.Exit(0)
	}
	if role == "desktop" {
		// Model the updater that intentionally outlives a normally closing app.
		cmd := exec.Command(os.Args[0], "-test.run=^TestLauncherJobHelper$")
		cmd.Env = append(os.Environ(), "EDUWORK_JOB_TEST=updater")
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_BREAKAWAY_FROM_JOB}
		time.Sleep(150 * time.Millisecond)
		if err := cmd.Start(); err != nil {
			os.Exit(3)
		}
	}
	if err := os.WriteFile(filepath.Join(os.Getenv("EDUWORK_JOB_DIR"), role+".pid"), []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
		os.Exit(4)
	}
	for {
		time.Sleep(time.Second)
	}
}

func alive(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	var code uint32
	if windows.GetExitCodeProcess(h, &code) != nil {
		return false
	}
	return code == 259
}

var isProcessInJob = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob")

func currentProcessInJob() bool {
	var result int32
	ok, _, _ := isProcessInJob.Call(uintptr(windows.CurrentProcess()), 0, uintptr(unsafe.Pointer(&result)))
	return ok != 0 && result != 0
}

func TestLauncherRelaunchHelper(t *testing.T) {
	role := os.Getenv("EDUWORK_RELAUNCH_TEST")
	if role == "" {
		return
	}
	dir := os.Getenv("EDUWORK_JOB_DIR")
	write := func(name, value string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
			os.Exit(4)
		}
	}
	writePID := func(name string) { write(name, strconv.Itoa(os.Getpid())) }
	sequence := func(value string) {
		file, err := os.OpenFile(filepath.Join(dir, "sequence.txt"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(5)
		}
		_, _ = file.WriteString(value + "\n")
		_ = file.Close()
	}
	if role == "launcher" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestLauncherRelaunchHelper$")
		cmd.Env = append(os.Environ(), "EDUWORK_RELAUNCH_TEST=desktop")
		if err := runChild(cmd); err != nil {
			os.Exit(2)
		}
		write("launcher.done", "done")
		sequence("launcher-done")
		os.Exit(0)
	}
	if role == "desktop" {
		background := exec.Command(os.Args[0], "-test.run=^TestLauncherRelaunchHelper$")
		background.Env = append(os.Environ(), "EDUWORK_RELAUNCH_TEST=background")
		if err := background.Start(); err != nil {
			os.Exit(3)
		}
		if os.Getenv("EDUWORK_RELAUNCH_SKIP") == "" {
			// Keep the controlled background child clearly older than the
			// relauncher, as a real Host predates a restart.
			time.Sleep(250 * time.Millisecond)
			relauncher := exec.Command(os.Args[0], "-test.run=^TestLauncherRelaunchHelper$", "--", "--type=relauncher")
			relauncher.Env = append(os.Environ(), "EDUWORK_RELAUNCH_TEST=relauncher", "EDUWORK_DESKTOP_PID="+strconv.Itoa(os.Getpid()))
			if err := relauncher.Start(); err != nil {
				os.Exit(3)
			}
		}
		writePID("desktop.pid")
		// Wait until both descendants are created while this desktop is in the
		// launcher job, as Electron does before it exits for a relaunch.
		required := []string{"background.pid"}
		if os.Getenv("EDUWORK_RELAUNCH_SKIP") == "" {
			required = append(required, "relauncher.pid")
		}
		for _, name := range required {
			for n := 0; n < 200; n++ {
				if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
		sequence("desktop-exit")
		os.Exit(0)
	}
	if role == "background" {
		writePID("background.pid")
		for {
			time.Sleep(time.Second)
		}
	}
	if role == "relauncher" {
		// The relauncher stays inside the launcher job, waits for the old
		// desktop to exit, then creates the successor without the marker, as
		// Electron's relauncher does.
		writePID("relauncher.pid")
		if currentProcessInJob() {
			write("relauncher.injob", "true")
		}
		if pid, err := strconv.Atoi(os.Getenv("EDUWORK_DESKTOP_PID")); err == nil {
			if handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
				_, _ = windows.WaitForSingleObject(handle, windows.INFINITE)
				windows.CloseHandle(handle)
			}
		}
		successor := exec.Command(os.Args[0], "-test.run=^TestLauncherRelaunchHelper$")
		successor.Env = append(os.Environ(), "EDUWORK_RELAUNCH_TEST=successor")
		if err := successor.Start(); err != nil {
			os.Exit(6)
		}
		for n := 0; n < 200; n++ {
			if _, err := os.Stat(filepath.Join(dir, "successor.pid")); err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		os.Exit(0)
	}
	// The successor is the new application, created after the old desktop exit.
	writePID("successor.pid")
	if currentProcessInJob() {
		write("successor.injob", "true")
	}
	delay := 700
	if value, err := strconv.Atoi(os.Getenv("EDUWORK_SUCCESSOR_MS")); err == nil && value > 0 {
		delay = value
	}
	time.Sleep(time.Duration(delay) * time.Millisecond)
	write("successor.done", "done")
	sequence("successor-done")
	os.Exit(0)
}

func waitForFile(t *testing.T, path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func readPID(t *testing.T, dir, role string, timeout time.Duration) int {
	path := filepath.Join(dir, role+".pid")
	if !waitForFile(t, path, timeout) {
		t.Fatal("test child did not start: " + role)
	}
	value, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(value)))
	if err != nil {
		t.Fatal(err)
	}
	return pid
}

func startRelaunchLauncherWithEnv(t *testing.T, skipRelaunch bool, extra ...string) (string, *exec.Cmd, map[string]int) {
	t.Helper()
	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestLauncherRelaunchHelper$")
	env := []string{"EDUWORK_RELAUNCH_TEST=launcher", "EDUWORK_JOB_DIR=" + dir}
	if skipRelaunch {
		env = append(env, "EDUWORK_RELAUNCH_SKIP=1")
	}
	env = append(env, extra...)
	cmd.Env = append(os.Environ(), env...)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pids := map[string]int{}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		for _, pid := range pids {
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	})
	return dir, cmd, pids
}

func startRelaunchLauncher(t *testing.T, skipRelaunch bool) (string, *exec.Cmd, map[string]int) {
	return startRelaunchLauncherWithEnv(t, skipRelaunch)
}

func assertRelaunchLifecycle(t *testing.T, dir string, pids map[string]int) {
	t.Helper()
	if !waitForFile(t, filepath.Join(dir, "relauncher.injob"), 8*time.Second) {
		t.Fatal("relauncher was not created inside the launcher job")
	}
	if !waitForFile(t, filepath.Join(dir, "successor.injob"), 8*time.Second) {
		t.Fatal("successor was not created inside the launcher job")
	}
	pids["desktop"] = readPID(t, dir, "desktop", time.Second)
	pids["background"] = readPID(t, dir, "background", time.Second)
	pids["relauncher"] = readPID(t, dir, "relauncher", time.Second)
	pids["successor"] = readPID(t, dir, "successor", time.Second)
	if !waitForFile(t, filepath.Join(dir, "successor.done"), 20*time.Second) {
		t.Fatal("successor did not finish")
	}
	if !waitForFile(t, filepath.Join(dir, "launcher.done"), 20*time.Second) {
		t.Fatal("launcher did not finish supervising the relaunched tree")
	}
	if alive(pids["background"]) {
		t.Fatal("background child survived the relaunch handoff")
	}
	if alive(pids["relauncher"]) {
		t.Fatal("relauncher survived its own completion")
	}
	if alive(pids["successor"]) {
		t.Fatal("successor survived its own completion")
	}
	sequence, err := os.ReadFile(filepath.Join(dir, "sequence.txt"))
	if err != nil {
		t.Fatal(err)
	}
	order := strings.Fields(string(sequence))
	index := func(value string) int {
		for i, item := range order {
			if item == value {
				return i
			}
		}
		return -1
	}
	if index("desktop-exit") < 0 || index("successor-done") < 0 || index("launcher-done") < 0 ||
		index("desktop-exit") > index("successor-done") || index("successor-done") > index("launcher-done") {
		t.Fatalf("unexpected lifecycle order: %v", order)
	}
}

func TestRelaunchSurvivesWhileBackgroundIsCleaned(t *testing.T) {
	dir, _, pids := startRelaunchLauncher(t, false)
	assertRelaunchLifecycle(t, dir, pids)
}

func TestDelayedJobNotificationsStillFindRelaunch(t *testing.T) {
	dir, _, pids := startRelaunchLauncherWithEnv(t, false, "EDUWORK_JOB_WATCH_DELAY_MS=1000", "EDUWORK_SUCCESSOR_MS=2500")
	assertRelaunchLifecycle(t, dir, pids)
}

func TestWatcherInitializationFailureStillFindsRelaunchAndReports(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "launcher.log")
	dir, _, pids := startRelaunchLauncherWithEnv(t, false, "EDUWORK_JOB_WATCH_FAIL=1", "EDUWORK_LAUNCHER_LOG="+logPath)
	assertRelaunchLifecycle(t, dir, pids)
	log, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "synthetic watcher initialization failure") || !strings.Contains(string(log), "checking descendants directly") {
		t.Fatalf("watcher failure was not reported: %s", log)
	}
}

func TestNormalExitWithoutRelaunchCleansBackground(t *testing.T) {
	dir, _, pids := startRelaunchLauncher(t, true)
	pids["desktop"] = readPID(t, dir, "desktop", 8*time.Second)
	pids["background"] = readPID(t, dir, "background", time.Second)
	if !waitForFile(t, filepath.Join(dir, "launcher.done"), 10*time.Second) {
		t.Fatal("launcher did not exit after a normal desktop exit")
	}
	if alive(pids["background"]) {
		t.Fatal("background child survived a normal exit without a relaunch")
	}
}

func TestKilledLauncherStopsRelaunchTree(t *testing.T) {
	dir, cmd, pids := startRelaunchLauncher(t, false)
	if !waitForFile(t, filepath.Join(dir, "relauncher.injob"), 8*time.Second) {
		t.Fatal("relauncher was not created inside the launcher job")
	}
	pids["background"] = readPID(t, dir, "background", time.Second)
	pids["relauncher"] = readPID(t, dir, "relauncher", time.Second)
	if _, err := os.Stat(filepath.Join(dir, "successor.pid")); err == nil {
		pids["successor"] = readPID(t, dir, "successor", time.Second)
	}
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
	deadline := time.Now().Add(5 * time.Second)
	for {
		anyAlive := false
		for _, pid := range pids {
			anyAlive = anyAlive || alive(pid)
		}
		if !anyAlive || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	for role, pid := range pids {
		if alive(pid) {
			t.Fatalf("killing the launcher left its %s descendant running", role)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "successor.done")); err == nil {
		t.Fatal("successor completed after the launcher was killed")
	}
}

func TestKilledShortcutStopsDesktopButDetachedUpdaterSurvives(t *testing.T) {
	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestLauncherJobHelper$")
	cmd.Env = append(os.Environ(), "EDUWORK_JOB_TEST=launcher", "EDUWORK_JOB_DIR="+dir)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	pids := map[string]int{}
	for _, role := range []string{"desktop", "updater"} {
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			if b, err := os.ReadFile(filepath.Join(dir, role+".pid")); err == nil {
				pids[role], _ = strconv.Atoi(strings.TrimSpace(string(b)))
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		pid := pids[role]
		if pid == 0 {
			t.Fatal("test child did not start: " + role)
		}
		t.Cleanup(func() {
			if p, e := os.FindProcess(pid); e == nil {
				_ = p.Kill()
			}
		})
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	deadline := time.Now().Add(5 * time.Second)
	for alive(pids["desktop"]) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if alive(pids["desktop"]) {
		t.Fatal("desktop survived the killed shortcut")
	}
	if !alive(pids["updater"]) {
		t.Fatal("detached updater was killed with the desktop")
	}
}
