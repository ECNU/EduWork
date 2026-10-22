package portable

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestApplicationProcessChild(t *testing.T) {
	if os.Getenv("EDUWORK_STOP_TEST_CHILD") != "1" {
		return
	}
	if e := os.WriteFile(os.Getenv("EDUWORK_STOP_TEST_READY"), []byte("ready"), 0600); e != nil {
		os.Exit(2)
	}
	time.Sleep(30 * time.Second)
}
func TestStopApplicationUsesExactInstallationDirectory(t *testing.T) {
	for _, mode := range []string{"absolute", "relative"} {
		t.Run(mode, func(t *testing.T) {
			start := func(root string) *exec.Cmd {
				exe, _ := os.Executable()
				b, e := os.ReadFile(exe)
				if e != nil {
					t.Fatal(e)
				}
				name := filepath.Join(root, "EduWork-Electron.exe")
				if e = os.WriteFile(name, b, 0700); e != nil {
					t.Fatal(e)
				}
				ready := filepath.Join(root, "ready")
				cmd := exec.Command(name, "-test.run=^TestApplicationProcessChild$")
				cmd.Env = append(os.Environ(), "EDUWORK_STOP_TEST_CHILD=1", "EDUWORK_STOP_TEST_READY="+ready)
				if e = cmd.Start(); e != nil {
					t.Fatal(e)
				}
				t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
				deadline := time.Now().Add(5 * time.Second)
				for {
					if _, e = os.Stat(ready); e == nil {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("child did not start")
					}
					time.Sleep(10 * time.Millisecond)
				}
				return cmd
			}
			target := t.TempDir()
			other := t.TempDir()
			start(target)
			start(other)
			if e := checkNotRunning(target); e == nil {
				t.Fatal("running process not detected")
			}
			stopTarget := target
			if mode == "relative" {
				t.Chdir(filepath.Dir(target))
				stopTarget = filepath.Base(target)
			}
			if e := StopApplication(stopTarget); e != nil {
				t.Fatal(e)
			}
			if e := checkNotRunning(target); e != nil {
				t.Fatal(e)
			}
			if e := checkNotRunning(other); e == nil {
				t.Fatal("unrelated installation was terminated")
			}
		})
	}
}
func TestConcurrentOverwriteRefused(t *testing.T) {
	target := t.TempDir()
	release, e := acquireInstallationLock(target)
	if e != nil {
		t.Fatal(e)
	}
	defer release()
	a := replacementFixture(t, map[string]string{})
	if _, e = a.Replace(context.Background(), target, nil); e == nil {
		t.Fatal("accepted concurrent install")
	}
}
