package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Exercise the launcher through real processes, without Electron's relauncher.
func TestExplicitRestartHelper(t *testing.T) {
	role := os.Getenv("EDUWORK_EXPLICIT_RESTART_TEST")
	if role == "" {
		return
	}
	dir := os.Getenv("EDUWORK_JOB_DIR")
	write := func(name, value string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
			os.Exit(4)
		}
	}
	if role == "launcher" {
		child := exec.Command(os.Args[0], "-test.run=^TestExplicitRestartHelper$")
		child.Args = append(child.Args, "--", "--update-health-file", "unfinished health", "--eduwork-migration", "migration path", "--lang=en")
		child.Env = append(os.Environ(), "EDUWORK_EXPLICIT_RESTART_TEST=desktop")
		if err := runChild(child); err != nil {
			write("launcher.error", err.Error())
			os.Exit(2)
		}
		write("launcher.done", "done")
		os.Exit(0)
	}
	if role == "helper" {
		write(os.Getenv("EDUWORK_HELPER_FILE"), strconv.Itoa(os.Getpid()))
		for {
			time.Sleep(time.Second)
		}
	}
	// Let the launcher assign this fixture to its Job before spawning children.
	time.Sleep(150 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(dir, "restart.requested")); err == nil {
		write("successor.pid", strconv.Itoa(os.Getpid()))
		write("successor.args", strings.Join(os.Args[2:], "\n"))
		if os.Getenv("EDUWORK_SUCCESSOR_HELPER") == "1" {
			startExplicitHelper(t, dir, "successor-helper.pid")
		}
		if os.Getenv("EDUWORK_SUCCESSOR_WAIT") == "1" {
			for {
				time.Sleep(time.Second)
			}
		}
		time.Sleep(600 * time.Millisecond)
		write("successor.done", "done")
		os.Exit(0)
	}
	write("desktop.pid", strconv.Itoa(os.Getpid()))
	startExplicitHelper(t, dir, "background.pid")
	if os.Getenv("EDUWORK_EXPLICIT_NORMAL_EXIT") == "1" {
		os.Exit(0)
	}
	if os.Getenv("EDUWORK_EXPLICIT_ERROR_EXIT") == "1" {
		os.Exit(7)
	}
	write("restart.requested", "yes")
	if os.Getenv("EDUWORK_EXPLICIT_UPDATED") == "1" {
		os.Exit(24)
	}
	os.Exit(23) // The shell explicitly requests a fresh desktop from its launcher.
}

func waitForFile(t *testing.T, path string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func startExplicitHelper(t *testing.T, dir, name string) {
	t.Helper()
	child := exec.Command(os.Args[0], "-test.run=^TestExplicitRestartHelper$")
	child.Env = append(os.Environ(), "EDUWORK_EXPLICIT_RESTART_TEST=helper", "EDUWORK_HELPER_FILE="+name)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	if !waitForFile(t, filepath.Join(dir, name), 5*time.Second) {
		t.Fatal("helper did not start")
	}
}

func TestExplicitRestartCleansOldJobAndSupervisesNewDesktop(t *testing.T) {
	launcher, dir := launchExplicit(t, "EDUWORK_SUCCESSOR_HELPER=1")
	pids := map[string]int{}
	for _, name := range []string{"desktop", "background", "successor", "successor-helper"} {
		pids[name] = explicitPID(t, dir, name)
	}
	if alive(pids["background"]) {
		t.Fatal("old background survived into the new desktop")
	}
	if !alive(launcher.Process.Pid) || !alive(pids["successor"]) {
		t.Fatal("launcher did not supervise the new desktop")
	}
	if !waitForFile(t, filepath.Join(dir, "launcher.done"), 5*time.Second) {
		t.Fatal("launcher did not finish after the restarted desktop")
	}
	for name, pid := range pids {
		if alive(pid) {
			t.Fatalf("%s survived launcher completion", name)
		}
	}
}

func launchExplicit(t *testing.T, env ...string) (*exec.Cmd, string) {
	t.Helper()
	dir := t.TempDir()
	launcher := exec.Command(os.Args[0], "-test.run=^TestExplicitRestartHelper$")
	launcher.Env = append(os.Environ(), "EDUWORK_EXPLICIT_RESTART_TEST=launcher", "EDUWORK_JOB_DIR="+dir)
	launcher.Env = append(launcher.Env, env...)
	if err := launcher.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = launcher.Process.Kill(); _ = launcher.Wait() })
	return launcher, dir
}

func explicitPID(t *testing.T, dir, name string) int {
	t.Helper()
	path := filepath.Join(dir, name+".pid")
	if !waitForFile(t, path, 5*time.Second) {
		detail, _ := os.ReadFile(filepath.Join(dir, "launcher.error"))
		t.Fatalf("%s did not start: %s", name, detail)
	}
	value, _ := os.ReadFile(path)
	pid, err := strconv.Atoi(string(value))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process, err := os.FindProcess(pid); err == nil {
			_ = process.Kill()
		}
	})
	return pid
}

func TestExplicitRestartArguments(t *testing.T) {
	for _, updated := range []bool{false, true} {
		t.Run(strconv.FormatBool(updated), func(t *testing.T) {
			mode := "0"
			if updated {
				mode = "1"
			}
			_, dir := launchExplicit(t, "EDUWORK_EXPLICIT_UPDATED="+mode)
			path := filepath.Join(dir, "successor.args")
			if !waitForFile(t, path, 5*time.Second) {
				t.Fatal("successor arguments not recorded")
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			want := "--\n--update-health-file\nunfinished health\n--eduwork-migration\nmigration path\n--lang=en"
			if updated {
				want = "--\n--lang=en"
			}
			if string(got) != want {
				t.Fatalf("successor args = %q; want %q", got, want)
			}
			if !waitForFile(t, filepath.Join(dir, "launcher.done"), 5*time.Second) {
				t.Fatal("restart did not complete")
			}
		})
	}
}

func TestOrdinaryAndAbnormalExitDoNotRestart(t *testing.T) {
	for _, mode := range []string{"NORMAL", "ERROR"} {
		t.Run(mode, func(t *testing.T) {
			_, dir := launchExplicit(t, "EDUWORK_EXPLICIT_"+mode+"_EXIT=1")
			background := explicitPID(t, dir, "background")
			result := "launcher.done"
			if mode == "ERROR" {
				result = "launcher.error"
			}
			if !waitForFile(t, filepath.Join(dir, result), 5*time.Second) {
				t.Fatal("launcher did not finish")
			}
			if _, err := os.Stat(filepath.Join(dir, "successor.pid")); !os.IsNotExist(err) {
				t.Fatal("unrequested restart")
			}
			if alive(background) {
				t.Fatal("background survived desktop exit")
			}
			if mode == "ERROR" {
				got, _ := os.ReadFile(filepath.Join(dir, result))
				if string(got) != "exit status 7" {
					t.Fatalf("unexpected error: %s", got)
				}
			}
		})
	}
}

func TestKilledLauncherStopsRestartedDesktopAndHelpers(t *testing.T) {
	launcher, dir := launchExplicit(t, "EDUWORK_SUCCESSOR_HELPER=1", "EDUWORK_SUCCESSOR_WAIT=1")
	pids := []int{explicitPID(t, dir, "successor"), explicitPID(t, dir, "successor-helper")}
	if err := launcher.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = launcher.Wait()
	for _, pid := range pids {
		deadline := time.Now().Add(3 * time.Second)
		for alive(pid) && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
		if alive(pid) {
			t.Fatalf("restarted process %d survived killed launcher", pid)
		}
	}
}
