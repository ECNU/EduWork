//go:build windows

package updater

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// otherVolumeDir returns a temporary directory on a different volume when the
// machine has one. CI images often expose only C:, so the test skips there;
// the same-volume rollback tests and the move helper cover the fallback path.
func otherVolumeDir(t *testing.T) string {
	t.Helper()
	for _, root := range []string{`D:\`, `E:\`} {
		if _, err := os.Stat(root); err != nil {
			continue
		}
		dir, err := os.MkdirTemp(root, "eduwork-cross-volume-")
		if err != nil {
			continue
		}
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
		return dir
	}
	t.Skip("no writable second volume for cross-volume update test")
	return ""
}

func crossVolumeFixture(t *testing.T, mode string) applyFixture {
	t.Helper()
	installDir := filepath.Join(t.TempDir(), "portable")
	stateDir := filepath.Join(otherVolumeDir(t), "state")
	if strings.EqualFold(filepath.VolumeName(installDir), filepath.VolumeName(stateDir)) {
		t.Skip("fixture did not land on a second volume")
	}
	return newApplyFixtureAt(t, "0.3.7", mode, installDir, stateDir)
}

func TestCrossVolumeUpdateBacksUpAndInstallsProgram(t *testing.T) {
	f := crossVolumeFixture(t, "healthy")
	pending, err := LoadPending(f.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyAndRestart(f.stateDir, pending, nil); err != nil {
		t.Fatalf("cross-volume update failed: %v", err)
	}
	assertFileValue(t, filepath.Join(f.installDir, "resources", "version.txt"), "new-version")
	assertFileValue(t, filepath.Join(f.installDir, "data", "user", "keep.txt"), "user-data")
	if _, err := os.Stat(PendingFile(f.stateDir)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending update was not cleared: %v", err)
	}
	if _, err := os.Stat(filepath.Join(f.stateDir, "updates", "transactions", pending.Version)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("completed cross-volume transaction was not removed: %v", err)
	}
}

func TestCrossVolumeFailedHealthRestoresProgram(t *testing.T) {
	f := crossVolumeFixture(t, "fail")
	pending, err := LoadPending(f.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	err = applyAndRestart(f.stateDir, pending, nil)
	if err == nil || !strings.Contains(err.Error(), "exited before startup health confirmation") {
		t.Fatalf("unexpected cross-volume rollback error: %v", err)
	}
	assertFileValue(t, filepath.Join(f.installDir, "resources", "version.txt"), "old-version")
	assertFileValue(t, filepath.Join(f.installDir, "data", "user", "keep.txt"), "user-data")
	backup := filepath.Join(f.stateDir, "updates", "transactions", pending.Version, "backup")
	if entries, readErr := os.ReadDir(backup); readErr == nil && len(entries) != 0 {
		t.Fatalf("cross-volume rollback left backup entries: %v", entries)
	}
}

func TestCrossVolumeDeleteFailureEntersRecoveryState(t *testing.T) {
	f := crossVolumeFixture(t, "healthy")
	pending, err := LoadPending(f.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	locked := filepath.Join(f.installDir, "resources", "z-locked.txt")
	writeFixtureFile(t, locked, []byte("readable but not deletable"))
	name, err := windows.UTF16PtrFromString(locked)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	err = applyAndRestart(f.stateDir, pending, nil)
	windows.CloseHandle(handle)
	if err == nil || !strings.Contains(err.Error(), "backup managed path resources") {
		t.Fatalf("locked source did not report a backup failure: %v", err)
	}
	var recovery *rollbackFailure
	if !errors.As(err, &recovery) {
		t.Fatalf("partial source deletion returned an ordinary failure, not recovery state: %v", err)
	}
	backup := filepath.Join(f.stateDir, "updates", "transactions", pending.Version, "backup")
	assertFileValue(t, filepath.Join(backup, "resources", "version.txt"), "old-version")
	assertFileValue(t, filepath.Join(backup, "resources", "z-locked.txt"), "readable but not deletable")
	// The backup is the only recoverable original; a retry must not silently
	// install over the damaged program.
	retryErr := applyAndRestart(f.stateDir, pending, nil)
	if !errors.As(retryErr, &recovery) || !strings.Contains(retryErr.Error(), "requires recovery") {
		t.Fatalf("retry did not preserve the recovery boundary: %v", retryErr)
	}
}
