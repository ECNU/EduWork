//go:build windows

package electronaccess

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{"EduWork-Electron.exe", "icudtl.dat", "locales/zh-CN.pak", "data/credentials.json", "resources/product/config.json", "other.exe"} {
		p := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("synthetic runtime or user data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func descriptor(t *testing.T, path string) string {
	t.Helper()
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	return sd.String()
}

func TestEnsurePreservesDataAndIsIdempotent(t *testing.T) {
	root := fixture(t)
	untouched := map[string]string{}
	for _, name := range []string{"data", "data/credentials.json", "resources", "resources/product/config.json", "other.exe"} {
		untouched[name] = descriptor(t, filepath.Join(root, name))
	}
	if err := Ensure(root); err != nil {
		t.Fatal(err)
	}
	paths, err := runtimePaths(root)
	if err != nil {
		t.Fatal(err)
	}
	after := map[string]string{}
	for _, path := range paths {
		d := descriptor(t, path)
		if !strings.Contains(d, ";;;S-1-15-2-2)") {
			t.Fatalf("missing runtime grant: %s %s", path, d)
		}
		if strings.Contains(d, "(A;OICI;0x1200a9;;;S-1-15-2-2)") {
			t.Fatalf("grant must not inherit: %s", d)
		}
		after[path] = d
	}
	if err = Ensure(root); err != nil {
		t.Fatal(err)
	}
	for path, want := range after {
		if got := descriptor(t, path); got != want {
			t.Fatalf("not idempotent: %s", path)
		}
	}
	for name, want := range untouched {
		if got := descriptor(t, filepath.Join(root, name)); got != want {
			t.Fatalf("changed user/other permissions: %s", name)
		}
	}
}

func TestFailureRestoresEarlierGrantsAndKeepsDeny(t *testing.T) {
	root := fixture(t)
	p := filepath.Join(root, "icudtl.dat")
	sd, err := windows.SecurityDescriptorFromString("D:P(D;;FR;;;S-1-15-2-2)(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;OW)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, _ := sd.DACL()
	if err = windows.SetNamedSecurityInfo(p, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	beforeRoot := descriptor(t, root)
	beforeExe := descriptor(t, filepath.Join(root, "EduWork-Electron.exe"))
	beforeData := descriptor(t, filepath.Join(root, "data/credentials.json"))
	beforeDeny := descriptor(t, p)
	if err = Ensure(root); err == nil {
		t.Fatal("must not override explicit deny")
	}
	for path, want := range map[string]string{root: beforeRoot, filepath.Join(root, "EduWork-Electron.exe"): beforeExe, filepath.Join(root, "data/credentials.json"): beforeData, p: beforeDeny} {
		if got := descriptor(t, path); got != want {
			t.Fatalf("failed operation changed %s: %s != %s", path, got, want)
		}
	}
}

func TestHardLinkedRuntimeDoesNotGrantAccessToOtherData(t *testing.T) {
	root := fixture(t)
	icu := filepath.Join(root, "icudtl.dat")
	if err := os.Remove(icu); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "data/credentials.json")
	if err := os.Link(data, icu); err != nil {
		t.Fatal(err)
	}
	want := descriptor(t, data)
	if err := Ensure(root); err == nil {
		t.Fatal("accepted hard-linked runtime")
	}
	if got := descriptor(t, data); got != want {
		t.Fatal("modified user data through hard link")
	}
}
