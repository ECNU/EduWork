//go:build windows

package workspaceaccess

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/winacl"
	"golang.org/x/sys/windows"
)

func validatePath(path string) error {
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) || strings.Contains(path[2:], ":") {
		return fmt.Errorf("workspace must be a local absolute directory")
	}
	path = filepath.Clean(path)
	if filepath.Dir(path) == path {
		return fmt.Errorf("drive roots are not repaired")
	}
	for _, key := range []string{"SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"} {
		root := os.Getenv(key)
		if root != "" && within(path, root) {
			return fmt.Errorf("managed system directories are not repaired")
		}
	}
	return nil
}

func within(path, root string) bool {
	rel, err := filepath.Rel(strings.ToLower(filepath.Clean(root)), strings.ToLower(filepath.Clean(path)))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, `..\`)
}

func fingerprint(h windows.Handle, sd *windows.SECURITY_DESCRIPTOR) (string, error) {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &info); err != nil {
		return "", err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return "", fmt.Errorf("workspace is not a directory")
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%x:%x:%x:%s", info.VolumeSerialNumber, info.FileIndexHigh, info.FileIndexLow, sd.String())))), nil
}

func inspect(path string, h windows.Handle, sd *windows.SECURITY_DESCRIPTOR) (Result, error) {
	result := Result{Path: path, Status: "unsupported"}
	// Enforce managed-directory exclusions against the opened long path too;
	// an 8.3 alias must not bypass a protected system-directory prefix.
	buffer := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(h, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return result, err
	}
	if n >= uint32(len(buffer)) {
		return result, fmt.Errorf("workspace path too long")
	}
	if err := validatePath(strings.TrimPrefix(windows.UTF16ToString(buffer[:n]), `\\?\`)); err != nil {
		return result, err
	}
	fp, err := fingerprint(h, sd)
	if err != nil {
		return result, err
	}
	result.Fingerprint, result.Before = fp, sd.String()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return result, err
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return result, err
	}
	if !windows.EqualSid(owner, user.User.Sid) {
		return result, nil
	}
	// Ask Windows for the actual access, not a particular allow ACE. These
	// opens do not change permissions. Check identity again after path lookup.
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return result, err
	}
	canOpen := func(mask uint32) (bool, error) {
		other, e := windows.CreateFile(p, mask|windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
			windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		if errors.Is(e, windows.ERROR_ACCESS_DENIED) {
			return false, nil
		}
		if e != nil {
			return false, e
		}
		defer windows.CloseHandle(other)
		otherSD, e := windows.GetSecurityInfo(other, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
		if e != nil {
			return false, e
		}
		otherFP, e := fingerprint(other, otherSD)
		if e != nil {
			return false, e
		}
		if fp != otherFP {
			return false, fmt.Errorf("workspace changed during inspection")
		}
		return true, nil
	}
	ownerAccess, err := canOpen(windows.WRITE_OWNER)
	if err != nil {
		return result, err
	}
	if ownerAccess {
		result.Status = "ready"
		return result, nil
	}
	daclAccess, err := canOpen(windows.WRITE_DAC)
	if err != nil || !daclAccess {
		return result, err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return result, err
	}
	if dacl == nil {
		return result, nil
	}
	for i := uint32(0); i < uint32(dacl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &ace); err != nil {
			return result, err
		}
		// Do not override a deny, including an inherited or conditional one.
		// Unfamiliar ACE formats are deliberately left for manual diagnosis.
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE && ace.Header.AceType != windows.ACCESS_DENIED_ACE_TYPE {
			return result, nil
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE && ace.Header.AceFlags&windows.INHERIT_ONLY_ACE == 0 && ace.Mask&(windows.WRITE_OWNER|windows.GENERIC_ALL) != 0 {
			return result, nil
		}
	}
	result.Status = "missing-write-owner"
	return result, nil
}

func Check(path string) (Result, error) {
	if err := validatePath(path); err != nil {
		return Result{}, err
	}
	h, sd, err := winacl.Open(path, false)
	if err != nil {
		return Result{}, err
	}
	defer windows.CloseHandle(h)
	return inspect(path, h, sd)
}

func Repair(path, expected string) (result Result, err error) {
	if err = validatePath(path); err != nil {
		return result, err
	}
	if len(expected) != 64 {
		return result, fmt.Errorf("a fresh inspection is required")
	}
	h, before, err := winacl.Open(path, true)
	if err != nil {
		return result, err
	}
	defer windows.CloseHandle(h)
	// Serialize this helper's repairs for the same filesystem object, including
	// callers that spell its path differently. Windows has no DACL compare/swap;
	// recheck immediately before applying as well to detect external changes.
	var identity windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &identity); err != nil {
		return result, err
	}
	mutexName, _ := windows.UTF16PtrFromString(fmt.Sprintf(`Local\EduWorkWorkspaceACL-%x-%x-%x`, identity.VolumeSerialNumber, identity.FileIndexHigh, identity.FileIndexLow))
	mutex, err := windows.CreateMutex(nil, false, mutexName)
	if err != nil {
		return result, err
	}
	defer windows.CloseHandle(mutex)
	// A Win32 mutex is owned by an OS thread, not a Go goroutine.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	wait, err := windows.WaitForSingleObject(mutex, 5000)
	if err != nil || (wait != windows.WAIT_OBJECT_0 && wait != windows.WAIT_ABANDONED) {
		return result, fmt.Errorf("workspace permission repair is busy: %v", err)
	}
	defer windows.ReleaseMutex(mutex)
	// The descriptor returned when opening may predate another serialized repair.
	before, err = windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil {
		return result, err
	}
	result, err = inspect(path, h, before)
	if err != nil {
		return result, err
	}
	if result.Fingerprint != expected {
		return result, fmt.Errorf("workspace permissions or identity changed; inspect again")
	}
	if result.Status != "missing-write-owner" {
		return result, fmt.Errorf("workspace does not qualify for this repair")
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return result, err
	}
	var pin runtime.Pinner
	pin.Pin(user.User.Sid)
	defer pin.Unpin()
	dacl, _, err := before.DACL()
	if err != nil {
		return result, err
	}
	merged, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{AccessPermissions: windows.WRITE_OWNER,
		AccessMode: windows.GRANT_ACCESS, Inheritance: windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{TrusteeForm: windows.TRUSTEE_IS_SID, TrusteeType: windows.TRUSTEE_IS_USER, TrusteeValue: windows.TrusteeValueFromSID(user.User.Sid)},
	}}, dacl)
	if err != nil {
		return result, err
	}
	updated, err := before.ToAbsolute()
	if err != nil {
		return result, err
	}
	if err = updated.SetDACL(merged, true, false); err != nil {
		return result, err
	}
	current, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil {
		return result, err
	}
	currentFP, err := fingerprint(h, current)
	if err != nil {
		return result, err
	}
	if currentFP != expected {
		return result, fmt.Errorf("workspace changed before applying permissions")
	}
	if err = winacl.SetDACL(h, updated); err != nil {
		return result, err
	}
	result.Status = "repair-unverified"
	runtime.KeepAlive(merged)
	after, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil {
		return result, fmt.Errorf("read repaired permissions: %w", err)
	}
	result.After = after.String()
	checked, verifyError := inspect(path, h, after)
	if verifyError != nil || checked.Status != "ready" {
		// Retain all other entries on success; on verification failure restore
		// exactly the original DACL using the same checked directory handle.
		current, readErr := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
		if readErr != nil || current.String() != result.After {
			return result, fmt.Errorf("workspace changed during verification; original permissions are in the saved inspection")
		}
		rollbackErr := winacl.SetDACL(h, before)
		if rollbackErr == nil {
			result.Status = "rolled-back"
		}
		return result, errors.Join(fmt.Errorf("workspace permission repair did not verify: %v", verifyError), rollbackErr)
	}
	result.Status = "repaired"
	return result, nil
}
