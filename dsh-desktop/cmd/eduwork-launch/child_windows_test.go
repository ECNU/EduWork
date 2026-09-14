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
