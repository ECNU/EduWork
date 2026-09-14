//go:build windows

package updater

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLaterBackupFailureRestoresEarlierRoots(t *testing.T) {
	f := newApplyFixture(t, "0.3.7", "healthy")
	p, _ := LoadPending(f.stateDir)
	old, _ := os.ReadFile(filepath.Join(f.installDir, p.ExecutableName))
	name, _ := windows.UTF16PtrFromString(filepath.Join(f.installDir, "resources"))
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if err = applyAndRestart(f.stateDir, p, nil); err == nil || !strings.Contains(err.Error(), "backup managed path resources") {
		t.Fatalf("unexpected error: %v", err)
	}
	now, err := os.ReadFile(filepath.Join(f.installDir, p.ExecutableName))
	if err != nil || !bytes.Equal(now, old) {
		t.Fatalf("earlier executable was not restored: %v", err)
	}
	assertFileValue(t, filepath.Join(f.installDir, "resources/version.txt"), "old-version")
}

func TestRollbackFailureReportsAndRetainsOriginalBackup(t *testing.T) {
	f := newApplyFixture(t, "0.3.7", "fail")
	p, _ := LoadPending(f.stateDir)
	var handle windows.Handle
	defer func() {
		if handle != 0 {
			windows.CloseHandle(handle)
		}
	}()
	err := applyAndRestart(f.stateDir, p, func(progress ApplyProgress) {
		if progress.Stage != "health" {
			return
		}
		name, _ := windows.UTF16PtrFromString(filepath.Join(f.installDir, "resources/version.txt"))
		var err error
		handle, err = windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
		if err != nil {
			t.Fatal(err)
		}
	})
	var recovery *rollbackFailure
	if !errors.As(err, &recovery) {
		t.Fatalf("rollback failure was hidden: %v", err)
	}
	assertFileValue(t, filepath.Join(recovery.Backup, "resources/version.txt"), "old-version")
	assertFileValue(t, filepath.Join(f.installDir, "data/user/keep.txt"), "user-data")
}

func TestLockedOldExecutableDoesNotRemoveUntouchedProgram(t *testing.T) {
	f := newApplyFixture(t, "0.3.7", "healthy")
	p, err := LoadPending(f.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(filepath.Join(f.installDir, p.ExecutableName))
	if err != nil {
		t.Fatal(err)
	}
	// Real Windows sharing violation, like a scanner or another open process.
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if err = applyAndRestart(f.stateDir, p, nil); err == nil || !strings.Contains(err.Error(), "backup managed path") {
		t.Fatalf("unexpected error: %v", err)
	}
	assertFileValue(t, filepath.Join(f.installDir, "resources/version.txt"), "old-version")
	assertFileValue(t, filepath.Join(f.installDir, "data/user/keep.txt"), "user-data")
}

func TestUpdateRetryPreservesIncompleteBackup(t *testing.T) {
	f := newApplyFixture(t, "0.3.7", "healthy")
	p, _ := LoadPending(f.stateDir)
	backup := filepath.Join(f.stateDir, "updates/transactions", p.Version, "backup/resources/version.txt")
	writeFixtureFile(t, backup, []byte("only remaining old program"))
	err := applyAndRestart(f.stateDir, p, nil)
	var recovery *rollbackFailure
	if !errors.As(err, &recovery) || !strings.Contains(err.Error(), "requires recovery") {
		t.Fatalf("unexpected error: %v", err)
	}
	assertFileValue(t, backup, "only remaining old program")
	assertFileValue(t, filepath.Join(f.installDir, "resources/version.txt"), "old-version")
}

func TestSuccessfulUpdateDoesNotDeleteOtherRecoveryBackup(t *testing.T) {
	f := newApplyFixture(t, "0.3.7", "healthy")
	p, _ := LoadPending(f.stateDir)
	backup := filepath.Join(f.stateDir, "updates/transactions/0.3.6/backup/old.txt")
	writeFixtureFile(t, backup, []byte("retain unrelated recovery"))
	if err := applyAndRestart(f.stateDir, p, nil); err != nil {
		t.Fatal(err)
	}
	assertFileValue(t, backup, "retain unrelated recovery")
	if _, err := os.Stat(filepath.Join(f.stateDir, "updates/transactions", p.Version)); !os.IsNotExist(err) {
		t.Fatalf("completed transaction not removed: %v", err)
	}
}
