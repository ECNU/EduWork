package updater

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
)

func TestInstallerLeaseBlocksUpdateAdmissionWithoutChangingState(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "data/state")
	pending := PendingUpdate{SchemaVersion: 1, Version: "1.0.0", State: "ready", InstallDir: root,
		ExecutableName: "EduWork-Electron.exe", ZIPPath: filepath.Join(state, "updates/downloads/next.zip")}
	if err := SavePending(state, pending); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(PendingFile(state))
	if err != nil {
		t.Fatal(err)
	}
	release, err := installguard.Acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, attempt := range []func() error{
		func() error { return LaunchPendingHelperFor(state, self, os.Getpid()) },
		func() error { return ApplyPending(PendingFile(state), 0) },
	} {
		if err := attempt(); !errors.Is(err, installguard.ErrBusy) {
			t.Fatalf("updater bypassed installer lease: %v", err)
		}
		actual, err := os.ReadFile(PendingFile(state))
		if err != nil || !bytes.Equal(actual, original) {
			t.Fatalf("pending state changed: %s (%v)", actual, err)
		}
	}
	for _, name := range []string{"helper", "transactions", "last-update-error.txt"} {
		if _, err := os.Stat(filepath.Join(state, "updates", name)); !os.IsNotExist(err) {
			t.Fatalf("updater modified %s: %v", name, err)
		}
	}
}
