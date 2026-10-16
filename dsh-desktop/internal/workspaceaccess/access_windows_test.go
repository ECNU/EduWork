//go:build windows

package workspaceaccess

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestMain(m *testing.M) {
	// Hosted Windows runners may start tests with ownership/restore privileges
	// already enabled. Exercise DACL access as an ordinary owner instead of
	// allowing those privileges to bypass the deliberately restricted fixture.
	// This affects only this test process; never enable a privilege or skip the
	// actual access assertions when the fixture cannot be prepared.
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &token); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, name := range []string{"SeBackupPrivilege", "SeRestorePrivilege", "SeTakeOwnershipPrivilege"} {
		var luid windows.LUID
		if err := windows.LookupPrivilegeValue(nil, windows.StringToUTF16Ptr(name), &luid); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		state := windows.Tokenprivileges{PrivilegeCount: 1}
		state.Privileges[0].Luid = luid
		if err := windows.AdjustTokenPrivileges(token, false, &state, 0, nil, nil); err != nil && !errors.Is(err, windows.ERROR_NOT_ALL_ASSIGNED) {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	token.Close()
	os.Exit(m.Run())
}

func syntheticWorkspace(t *testing.T, extra string) string {
	t.Helper()
	root := t.TempDir()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sid := user.User.Sid.String()
	sd, err := windows.SecurityDescriptorFromString("O:" + sid + "D:P" + extra + "(A;OICI;0x1301bf;;;" + sid + ")(A;OICI;FA;;;SY)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, _ := sd.DACL()
	if err = windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, user.User.Sid, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(root, "child"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "child/sentinel.txt"), []byte("synthetic user content"), 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func security(t *testing.T, path string) string {
	t.Helper()
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION|windows.LABEL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	return sd.String()
}

func TestRepairOnlyConfirmedRootRight(t *testing.T) {
	foreign := "(A;;FR;;;S-1-15-2-111111111-222222222-333333333-444444444-555555555-666666666-777777777)"
	root := syntheticWorkspace(t, foreign)
	beforeChild := security(t, filepath.Join(root, "child"))
	beforeFile := security(t, filepath.Join(root, "child/sentinel.txt"))
	before, err := Check(root)
	if err != nil {
		t.Fatal(err)
	}
	if before.Status != "missing-write-owner" {
		t.Fatalf("fixture did not lack WRITE_OWNER: %+v", before)
	}
	if _, err = Repair(root, strings.Repeat("0", 64)); err == nil {
		t.Fatal("accepted stale inspection")
	}
	result, err := Repair(root, before.Fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "repaired" {
		t.Fatalf("%+v", result)
	}
	if !strings.Contains(result.After, foreign) {
		t.Fatalf("foreign app ACE changed: %s", result.After)
	}
	if security(t, filepath.Join(root, "child")) != beforeChild || security(t, filepath.Join(root, "child/sentinel.txt")) != beforeFile {
		t.Fatal("root repair propagated into children")
	}
	bytes, _ := os.ReadFile(filepath.Join(root, "child/sentinel.txt"))
	if string(bytes) != "synthetic user content" {
		t.Fatal("user content changed")
	}
	after, err := Check(root)
	if err != nil || after.Status != "ready" {
		t.Fatalf("actual WRITE_OWNER open failed: %+v %v", after, err)
	}
	if _, err = Repair(root, after.Fingerprint); err == nil {
		t.Fatal("repaired an already ready root")
	}
	// Newly added WRITE_OWNER must not become inheritable or include new rights.
	user, _ := windows.GetCurrentProcessToken().GetTokenUser()
	sd, _ := windows.GetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	dacl, _, _ := sd.DACL()
	for i := uint32(0); i < uint32(dacl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &ace); err != nil {
			t.Fatal(err)
		}
		if windows.EqualSid((*windows.SID)(unsafe.Pointer(&ace.SidStart)), user.User.Sid) && ace.Mask&windows.WRITE_OWNER != 0 {
			if ace.Header.AceFlags&(windows.CONTAINER_INHERIT_ACE|windows.OBJECT_INHERIT_ACE) != 0 {
				t.Fatal("WRITE_OWNER must not inherit")
			}
			if ace.Mask & ^windows.ACCESS_MASK(windows.WRITE_OWNER|0x1301bf) != 0 {
				t.Fatalf("granted extra rights: %x", ace.Mask)
			}
		}
	}
}

func TestExplicitDenyIsNotRepaired(t *testing.T) {
	user, _ := windows.GetCurrentProcessToken().GetTokenUser()
	root := syntheticWorkspace(t, "(D;;WO;;;"+user.User.Sid.String()+")")
	before := security(t, root)
	result, err := Check(root)
	if err != nil || result.Status != "unsupported" {
		t.Fatalf("%+v %v", result, err)
	}
	if _, err := Repair(root, result.Fingerprint); err == nil {
		t.Fatal("bypassed deny")
	}
	if security(t, root) != before {
		t.Fatal("changed denied root")
	}
}

func TestInspectionDetectsChangedDACL(t *testing.T) {
	root := syntheticWorkspace(t, "")
	before, err := Check(root)
	if err != nil {
		t.Fatal(err)
	}
	user, _ := windows.GetCurrentProcessToken().GetTokenUser()
	sd, _ := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + user.User.Sid.String() + ")")
	dacl, _, _ := sd.DACL()
	if err := windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	changed := security(t, root)
	if _, err := Repair(root, before.Fingerprint); err == nil {
		t.Fatal("accepted changed DACL")
	}
	if security(t, root) != changed {
		t.Fatal("overwrote concurrent permissions")
	}
}

func TestWorkspacePathBoundaries(t *testing.T) {
	for _, path := range []string{`C:\`, `relative`, `\\server\share\workspace`, `C:\workspace:stream`, os.Getenv("SystemRoot")} {
		if _, err := Check(path); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	root := syntheticWorkspace(t, "")
	before := security(t, root)
	link := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, link); err == nil {
		if _, err := Check(link); err == nil {
			t.Fatal("accepted reparse path")
		}
	}
	if security(t, root) != before {
		t.Fatal("inspection mutated root")
	}
}
