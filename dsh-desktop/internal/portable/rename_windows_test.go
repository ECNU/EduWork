package portable

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func lockedDirectory(t *testing.T) (*os.Root, windows.Handle) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "stage"), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "stage/file.txt")
	if err := os.WriteFile(path, []byte("synthetic scanner handle"), 0600); err != nil {
		t.Fatal(err)
	}
	name, _ := windows.UTF16PtrFromString(path)
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		windows.CloseHandle(handle)
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return root, handle
}

func TestRenameRetriesActualWindowsHandleAndSucceeds(t *testing.T) {
	root, h := lockedDirectory(t)
	closed := false
	defer func() {
		if !closed {
			windows.CloseHandle(h)
		}
	}()
	notified := false
	err := renameDirectory(context.Background(), root, "stage", "installed", func(p Progress) {
		notified = true
		windows.CloseHandle(h)
		closed = true
	})
	if err != nil || !notified {
		t.Fatalf("retry did not recover: %v (%v)", err, notified)
	}
	if _, err = root.Stat("installed/file.txt"); err != nil {
		t.Fatal(err)
	}
}

func TestRenameCancellationDoesNotWaitOrLoseData(t *testing.T) {
	root, h := lockedDirectory(t)
	defer windows.CloseHandle(h)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start := time.Now()
	err := renameDirectory(ctx, root, "stage", "installed", func(Progress) { cancel() })
	if !errors.Is(err, context.Canceled) || time.Since(start) > time.Second {
		t.Fatalf("cancellation not respected: %v", err)
	}
	if _, err = root.Stat("stage/file.txt"); err != nil {
		t.Fatal(err)
	}
}

func TestRenameRefusesDestinationCreatedDuringRetry(t *testing.T) {
	root, h := lockedDirectory(t)
	defer windows.CloseHandle(h)
	err := renameDirectory(context.Background(), root, "stage", "installed", func(Progress) {
		if err := root.Mkdir("installed", 0700); err != nil {
			t.Fatal(err)
		}
		if err := root.WriteFile("installed/keep", []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
	})
	if err == nil || !strings.Contains(err.Error(), "不会覆盖") {
		t.Fatalf("destination conflict was ignored: %v", err)
	}
	if got, err := root.ReadFile("installed/keep"); err != nil || string(got) != "keep" {
		t.Fatal("destination changed")
	}
}

func TestPermanentLockHasBoundedWait(t *testing.T) {
	root, h := lockedDirectory(t)
	defer windows.CloseHandle(h)
	start := time.Now()
	err := renameDirectory(context.Background(), root, "stage", "installed", nil)
	if err == nil || !transientRenameError(err) {
		t.Fatalf("unexpected result: %v", err)
	}
	if elapsed := time.Since(start); elapsed < 4*time.Second || elapsed > 10*time.Second {
		t.Fatalf("unexpected wait: %v", elapsed)
	}
}
