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

func TestMoveManagedPathAcrossVolumesCopiesAndRemoves(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "program", "resources")
	writeFixtureFile(t, filepath.Join(source, "bin", "app.exe"), []byte("old-program"))
	writeFixtureFile(t, filepath.Join(source, "version.txt"), []byte("old-version"))
	target := filepath.Join(root, "transaction", "backup", "resources")
	rename := func(string, string) error {
		return &os.LinkError{Op: "rename", Old: source, New: target, Err: windows.ERROR_NOT_SAME_DEVICE}
	}
	if err := moveManagedPathWithRename(source, target, rename); err != nil {
		t.Fatalf("cross-volume move failed: %v", err)
	}
	assertFileValue(t, filepath.Join(target, "bin", "app.exe"), "old-program")
	assertFileValue(t, filepath.Join(target, "version.txt"), "old-version")
	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source survived cross-volume move: %v", err)
	}
}

func TestMoveManagedPathRestoresAcrossVolumesToo(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "transaction", "backup", "resources")
	writeFixtureFile(t, filepath.Join(source, "bin", "app.exe"), []byte("restored-program"))
	target := filepath.Join(root, "program", "resources")
	rename := func(string, string) error {
		return &os.LinkError{Op: "rename", Old: source, New: target, Err: windows.ERROR_NOT_SAME_DEVICE}
	}
	if err := moveManagedPathWithRename(source, target, rename); err != nil {
		t.Fatalf("cross-volume restore failed: %v", err)
	}
	assertFileValue(t, filepath.Join(target, "bin", "app.exe"), "restored-program")
	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("backup survived cross-volume restore: %v", err)
	}
}

func TestMoveManagedPathUsesRenameWhenAvailable(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "program", "resources")
	writeFixtureFile(t, filepath.Join(source, "version.txt"), []byte("old-version"))
	target := filepath.Join(root, "transaction", "backup", "resources")
	if err := moveManagedPath(source, target); err != nil {
		t.Fatalf("same-volume move failed: %v", err)
	}
	assertFileValue(t, filepath.Join(target, "version.txt"), "old-version")
	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source survived same-volume move: %v", err)
	}
}

func TestMoveManagedPathRejectsMissingSourceAndExistingTarget(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "transaction", "backup", "resources")
	if err := moveManagedPathWithRename(filepath.Join(root, "missing"), target, func(string, string) error {
		return &os.LinkError{Op: "rename", Err: windows.ERROR_NOT_SAME_DEVICE}
	}); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source was not reported: %v", err)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source created a target: %v", err)
	}
	source := filepath.Join(root, "program", "resources")
	writeFixtureFile(t, filepath.Join(source, "version.txt"), []byte("old-version"))
	writeFixtureFile(t, filepath.Join(target, "stale.txt"), []byte("stale-backup"))
	err := moveManagedPathWithRename(source, target, func(string, string) error {
		return &os.LinkError{Op: "rename", Err: windows.ERROR_NOT_SAME_DEVICE}
	})
	if err == nil || !strings.Contains(err.Error(), "target already exists") {
		t.Fatalf("existing target was not rejected: %v", err)
	}
	assertFileValue(t, filepath.Join(target, "stale.txt"), "stale-backup")
}

func TestMoveManagedPathRemovesPartialTargetWhenCopyFails(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "program", "resources")
	writeFixtureFile(t, filepath.Join(source, "a.txt"), []byte("copied-before-failure"))
	link := filepath.Join(source, "linked")
	if err := os.Symlink(filepath.Join(root, "outside"), link); err != nil {
		if errors.Is(err, windows.ERROR_PRIVILEGE_NOT_HELD) {
			t.Skip("symbolic links require Developer Mode or privilege")
		}
		t.Fatal(err)
	}
	target := filepath.Join(root, "transaction", "backup", "resources")
	err := moveManagedPathWithRename(source, target, func(string, string) error {
		return &os.LinkError{Op: "rename", Err: windows.ERROR_NOT_SAME_DEVICE}
	})
	if err == nil || !strings.Contains(err.Error(), "filesystem link") {
		t.Fatalf("symlink copy failure was hidden: %v", err)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("partial target was not removed: %v", err)
	}
	assertFileValue(t, filepath.Join(source, "a.txt"), "copied-before-failure")
}

func TestMoveManagedPathDoesNotMaskOtherRenameErrors(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "program", "app.exe")
	writeFixtureFile(t, source, []byte("locked"))
	target := filepath.Join(root, "transaction", "backup", "app.exe")
	rename := func(string, string) error {
		return &os.LinkError{Op: "rename", Old: source, New: target, Err: windows.ERROR_ACCESS_DENIED}
	}
	err := moveManagedPathWithRename(source, target, rename)
	if err == nil || !errors.Is(err, windows.ERROR_ACCESS_DENIED) || !strings.Contains(err.Error(), "rename") {
		t.Fatalf("sharing/permission error was hidden: %v", err)
	}
	if _, statErr := os.Stat(target); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("non-cross-volume failure copied the tree: %v", statErr)
	}
	if _, statErr := os.Stat(source); statErr != nil {
		t.Fatalf("non-cross-volume failure removed the source: %v", statErr)
	}
}
