package portable

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
	"golang.org/x/sys/windows"
)

func TestInstallerGuardChild(t *testing.T) {
	mode := os.Getenv("EDUWORK_INSTALL_GUARD_CHILD")
	if mode == "" {
		return
	}
	if mode == "lease" {
		release, err := installguard.Acquire(os.Getenv("EDUWORK_INSTALL_GUARD_TARGET"))
		if err != nil {
			os.Exit(2)
		}
		defer release()
	}
	var window uintptr
	user := windows.NewLazySystemDLL("user32.dll")
	if mode == "graceful" {
		runtime.LockOSThread()
		class, _ := windows.UTF16PtrFromString("STATIC")
		window, _, _ = user.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 1, 1, 0, 0, 0, 0)
		if window == 0 {
			os.Exit(3)
		}
	}
	ready := os.Getenv("EDUWORK_INSTALL_GUARD_READY")
	if err := os.WriteFile(ready, []byte("ready"), 0600); err != nil {
		os.Exit(4)
	}
	if mode == "graceful" {
		var message struct {
			Window         uintptr
			Message        uint32
			WParam, LParam uintptr
			Time           uint32
			Point          [2]int32
			Private        uint32
		}
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			for {
				ok, _, _ := user.NewProc("PeekMessageW").Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0, 1)
				if ok == 0 {
					break
				}
				user.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
			}
			if exists, _, _ := user.NewProc("IsWindow").Call(window); exists == 0 {
				if err := os.WriteFile(ready+".graceful", []byte("closed"), 0600); err != nil {
					os.Exit(5)
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	time.Sleep(30 * time.Second)
}

func startGuardProcess(t *testing.T, directory, mode, target string) *exec.Cmd {
	t.Helper()
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(directory, "EduWork-Electron.exe")
	if err := os.WriteFile(image, bytes, 0700); err != nil {
		t.Fatal(err)
	}
	ready := filepath.Join(directory, "guard-ready")
	command := exec.Command(image, "-test.run=^TestInstallerGuardChild$")
	command.Env = append(os.Environ(), "EDUWORK_INSTALL_GUARD_CHILD="+mode, "EDUWORK_INSTALL_GUARD_TARGET="+target, "EDUWORK_INSTALL_GUARD_READY="+ready)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("isolated child did not become ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	return command
}

func assertGuardProcessAlive(t *testing.T, command *exec.Cmd) {
	t.Helper()
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(command.Process.Pid))
	if err != nil {
		t.Fatal("protected process ended", err)
	}
	defer windows.CloseHandle(handle)
	state, err := windows.WaitForSingleObject(handle, 0)
	if err != nil || state != uint32(windows.WAIT_TIMEOUT) {
		t.Fatalf("protected process ended: %d (%v)", state, err)
	}
}

func TestOverwriteRejectsActiveUpdateWithoutStoppingHelperOrClient(t *testing.T) {
	for _, state := range []string{"applying", "ready", "absent"} {
		t.Run(state, func(t *testing.T) {
			old := replacementFixture(t, map[string]string{"same.txt": "old", "config/user.json": "private", "data/sessions/a": "session"})
			target := filepath.Join(t.TempDir(), "app")
			if _, err := old.Extract(context.Background(), target, nil); err != nil {
				t.Fatal(err)
			}
			client := startGuardProcess(t, target, "client", "")
			helper := startGuardProcess(t, filepath.Join(target, "data/state/updates/helper"), "helper", "")
			pending := filepath.Join(target, "data/state/updates/pending-update.json")
			if state != "absent" {
				if err := os.WriteFile(pending, []byte(`{"state":"`+state+`"}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			next := replacementFixture(t, map[string]string{"same.txt": "new", "config/user.json": "default"})
			if err := StopApplication(target); !errors.Is(err, installguard.ErrUpdateActive) {
				t.Fatalf("shutdown admitted update: %v", err)
			}
			if _, err := next.ReplaceWithOptions(context.Background(), target, ReplaceOptions{CloseRunning: true}, nil); !errors.Is(err, installguard.ErrUpdateActive) {
				t.Fatalf("overwrite admitted update: %v", err)
			}
			assertGuardProcessAlive(t, helper)
			assertGuardProcessAlive(t, client)
			for name, want := range map[string]string{"same.txt": "old", "config/user.json": "private", "data/sessions/a": "session"} {
				got, err := os.ReadFile(filepath.Join(target, name))
				if err != nil || string(got) != want {
					t.Fatalf("changed %s: %q (%v)", name, got, err)
				}
			}
			if state != "absent" {
				got, err := os.ReadFile(pending)
				if err != nil || string(got) != `{"state":"`+state+`"}` {
					t.Fatalf("pending changed: %s (%v)", got, err)
				}
			}
			entries, err := os.ReadDir(filepath.Dir(target))
			if err != nil || len(entries) != 1 {
				t.Fatalf("rejected install left staging files: %v (%v)", entries, err)
			}
		})
	}
}

func TestUpdaterLeaseRejectsInstallerBeforeStoppingClient(t *testing.T) {
	target := t.TempDir()
	client := startGuardProcess(t, target, "client", "")
	helper := startGuardProcess(t, t.TempDir(), "lease", target)
	if err := StopApplication(target); !errors.Is(err, installguard.ErrBusy) {
		t.Fatalf("ignored updater lease: %v", err)
	}
	assertGuardProcessAlive(t, client)
	assertGuardProcessAlive(t, helper)
	_ = helper.Process.Kill()
	_ = helper.Wait()
	release, err := installguard.Acquire(target)
	if err != nil {
		t.Fatal("process exit did not release lease", err)
	}
	release()
}

func TestStopApplicationPrefersGracefulClose(t *testing.T) {
	target := t.TempDir()
	child := startGuardProcess(t, target, "graceful", "")
	if err := StopApplication(target); err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "guard-ready.graceful")); err != nil {
		t.Fatal("client was terminated instead of closing normally", err)
	}
}

func TestOverwriteLeaseCoversRollback(t *testing.T) {
	old := replacementFixture(t, map[string]string{"same.txt": "old"})
	target := filepath.Join(t.TempDir(), "app")
	if _, err := old.Extract(context.Background(), target, nil); err != nil {
		t.Fatal(err)
	}
	next := replacementFixture(t, map[string]string{"same.txt": "new"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	observed := false
	_, err := next.Replace(ctx, target, func(progress Progress) {
		if strings.HasPrefix(progress.Message, "正在替换应用文件…") || strings.HasPrefix(progress.Message, "正在恢复原有应用") {
			observed = true
			if release, err := installguard.Acquire(target); !errors.Is(err, installguard.ErrBusy) {
				if release != nil {
					release()
				}
				t.Errorf("replacement/rollback lost lease: %v", err)
			}
			cancel()
		}
	})
	if !observed || !errors.Is(err, context.Canceled) {
		t.Fatalf("expected protected rollback: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(target, "same.txt"))
	if err != nil || string(got) != "old" {
		t.Fatalf("rollback failed: %q (%v)", got, err)
	}
	release, err := installguard.Acquire(target)
	if err != nil {
		t.Fatal("rollback retained lease", err)
	}
	release()
}

func TestProcessRecognitionAcrossShortAndLongPaths(t *testing.T) {
	target := t.TempDir()
	name, _ := windows.UTF16PtrFromString(target)
	buffer := make([]uint16, 32768)
	n, err := windows.GetShortPathName(name, &buffer[0], uint32(len(buffer)))
	if err != nil || n == 0 || n >= uint32(len(buffer)) {
		t.Fatalf("short path: %d (%v)", n, err)
	}
	alias := windows.UTF16ToString(buffer[:n])
	client := startGuardProcess(t, alias, "client", "")
	helper := startGuardProcess(t, filepath.Join(alias, "data/state/updates/helper"), "helper", "")
	if err := StopApplication(target); !errors.Is(err, installguard.ErrUpdateActive) {
		t.Fatalf("short-path helper not protected: %v", err)
	}
	assertGuardProcessAlive(t, client)
	assertGuardProcessAlive(t, helper)
	_ = helper.Process.Kill()
	_ = helper.Wait()
	if err := StopApplication(target); err != nil {
		t.Fatal(err)
	}
	if err := checkNotRunning(alias); err != nil {
		t.Fatal("short-path client not closed", err)
	}
}
