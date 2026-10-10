//go:build windows

package electronaccess

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestShortInstallPathIsAccepted(t *testing.T) {
	root := fixture(t)
	p, err := windows.UTF16PtrFromString(root)
	if err != nil {
		t.Fatal(err)
	}
	buffer := make([]uint16, 32768)
	n, err := windows.GetShortPathName(p, &buffer[0], uint32(len(buffer)))
	if err != nil || n >= uint32(len(buffer)) {
		t.Fatalf("get short path: %v", err)
	}
	short := windows.UTF16ToString(buffer[:n])
	if strings.EqualFold(short, root) {
		t.Skip("8.3 aliases are disabled on this volume")
	}
	if err := Ensure(short); err != nil {
		t.Fatalf("valid short path rejected: %v", err)
	}
	if got := descriptor(t, filepath.Join(root, "EduWork-Electron.exe")); !strings.Contains(got, ";;;S-1-15-2-2)") {
		t.Fatalf("runtime grant missing: %s", got)
	}
}

func TestLinkedAncestorDoesNotModifyTarget(t *testing.T) {
	root := fixture(t)
	link := filepath.Join(t.TempDir(), "linked-parent")
	if err := os.Symlink(filepath.Dir(root), link); err != nil {
		if errors.Is(err, windows.ERROR_PRIVILEGE_NOT_HELD) {
			t.Skip("symbolic links require Developer Mode or privilege")
		}
		t.Fatal(err)
	}
	want := descriptor(t, root)
	if err := Ensure(filepath.Join(link, filepath.Base(root))); err == nil {
		t.Fatal("accepted redirected ancestor")
	}
	if got := descriptor(t, root); got != want {
		t.Fatal("modified permissions through linked ancestor")
	}
}

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
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	return sd.String()
}

func TestLegacyInheritanceDoesNotRewriteChildren(t *testing.T) {
	root := fixture(t)
	// Reproduce a legacy, non-auto-inherited child DACL such as the one on
	// hosted Windows runners. SetKernelObjectSecurity is used only to create
	// this synthetic legacy state without the normal inheritance conversion.
	child := filepath.Join(root, "data/credentials.json")
	p, _ := windows.UTF16PtrFromString(child)
	h, err := windows.CreateFile(p, windows.WRITE_DAC, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;OW)")
	if err != nil {
		windows.CloseHandle(h)
		t.Fatal(err)
	}
	err = windows.SetKernelObjectSecurity(h, windows.DACL_SECURITY_INFORMATION, sd)
	windows.CloseHandle(h)
	if err != nil {
		t.Fatal(err)
	}
	want := descriptor(t, child)
	if err = Ensure(root); err != nil {
		t.Fatal(err)
	}
	if got := descriptor(t, child); got != want {
		t.Fatalf("rewrote legacy child DACL: %s != %s", got, want)
	}
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

func TestRuntimeKeepsExistingInheritanceAndOwner(t *testing.T) {
	for _, protected := range []bool{false, true} {
		t.Run(map[bool]string{false: "inherited", true: "protected"}[protected], func(t *testing.T) {
			root := fixture(t)
			if protected {
				sd, err := windows.GetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
				if err != nil {
					t.Fatal(err)
				}
				dacl, _, err := sd.DACL()
				if err != nil {
					t.Fatal(err)
				}
				if err = windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
					t.Fatal(err)
				}
			}
			before := descriptor(t, root)
			if err := Ensure(root); err != nil {
				t.Fatal(err)
			}
			if got := strings.ReplaceAll(descriptor(t, root), "(A;;0x1200a9;;;S-1-15-2-2)", ""); got != before {
				t.Fatalf("changed existing root permissions: %s != %s", got, before)
			}
			child := filepath.Join(root, "new-user-file")
			if err := os.WriteFile(child, []byte("synthetic user data"), 0600); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(descriptor(t, child), ";;;S-1-15-2-2)") {
				t.Fatal("runtime grant inherited into user file")
			}
		})
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
