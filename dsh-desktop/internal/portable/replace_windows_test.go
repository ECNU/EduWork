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
	old := replacementFixture(t, map[string]string{"a-first": "old first", "z-locked": "old locked"})
	target := filepath.Join(t.TempDir(), "app")
	if _, e := old.Extract(context.Background(), target, nil); e != nil {
		t.Fatal(e)
	}
	next := replacementFixture(t, map[string]string{"a-first": "new first", "z-locked": "new locked"})
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
	for name, want := range map[string]string{"a-first": "old first", "z-locked": "old locked"} {
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
