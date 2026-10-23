package portable

import (
	"context"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplaceLockedFileRollsBackEarlierChanges(t *testing.T) {
	old := replacementFixture(t, map[string]string{"a-first": "old first", "a-batch/component": "old component", "z-locked": "old locked"})
	target := filepath.Join(t.TempDir(), "app")
	if _, e := old.Extract(context.Background(), target, nil); e != nil {
		t.Fatal(e)
	}
	next := replacementFixture(t, map[string]string{"a-first": "new first", "a-batch/component": "new component", "z-locked": "new locked"})
	name, _ := windows.UTF16PtrFromString(filepath.Join(target, "z-locked"))
	handle, e := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
	if e != nil {
		t.Fatal(e)
	}
	defer windows.CloseHandle(handle)
	_, e = next.Replace(context.Background(), target, nil)
	if e == nil || !strings.Contains(e.Error(), "文件被占用") {
		t.Fatalf("expected sharing failure: %v", e)
	}
	for name, want := range map[string]string{"a-first": "old first", "a-batch/component": "old component", "z-locked": "old locked"} {
		b, _ := os.ReadFile(filepath.Join(target, name))
		if string(b) != want {
			t.Fatalf("rollback %s: %s", name, b)
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Fatal("temporary files remain")
	}
}

func TestReplaceCleanupFailureKeepsCommittedInstallation(t *testing.T) {
	for _, kind := range []string{"replace", "backup"} {
		t.Run(kind, func(t *testing.T) {
			old := replacementFixture(t, map[string]string{"same.txt": "old", "config/user.json": "private"})
			target := filepath.Join(t.TempDir(), "app")
			if _, err := old.Extract(context.Background(), target, nil); err != nil {
				t.Fatal(err)
			}
			next := replacementFixture(t, map[string]string{"same.txt": "new", "config/user.json": "defaults"})
			var handle windows.Handle
			t.Cleanup(func() {
				if handle != 0 {
					windows.CloseHandle(handle)
				}
			})
			var leftover string
			var warnings []string
			result, err := next.Replace(context.Background(), target, func(p Progress) {
				if p.Warning {
					warnings = append(warnings, p.Message)
					return
				}
				if p.Percent != 96 {
					return
				}
				entries, err := os.ReadDir(filepath.Dir(target))
				if err != nil {
					t.Fatal(err)
				}
				for _, entry := range entries {
					if strings.HasPrefix(entry.Name(), ".eduwork-"+kind+"-") {
						leftover = filepath.Join(filepath.Dir(target), entry.Name())
					}
				}
				if leftover == "" {
					t.Fatal("cleanup directory missing before commit cleanup")
				}
				name := "same.txt"
				if kind == "replace" {
					name = "config/user.json"
				}
				path, err := windows.UTF16PtrFromString(filepath.Join(leftover, name))
				if err != nil {
					t.Fatal(err)
				}
				handle, err = windows.CreateFile(path, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, 0, 0)
				if err != nil {
					t.Fatal(err)
				}
			})
			if err != nil || result != target {
				t.Fatalf("committed installation reported failure: %q, %v", result, err)
			}
			if len(warnings) != 1 || !strings.Contains(warnings[0], leftover) {
				t.Fatalf("cleanup warning did not identify remaining directory: %v", warnings)
			}
			for name, want := range map[string]string{"same.txt": "new", "config/user.json": "private"} {
				got, err := os.ReadFile(filepath.Join(target, name))
				if err != nil || string(got) != want {
					t.Fatalf("installed %s: %q (%v)", name, got, err)
				}
			}
			if _, err := os.Stat(leftover); err != nil {
				t.Fatal("reported cleanup directory does not exist", err)
			}
		})
	}
}
