//go:build windows

package electronaccess

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const restrictedPackages = "S-1-15-2-2"
const readExecute = windows.FILE_GENERIC_READ | windows.FILE_GENERIC_EXECUTE

type change struct {
	handle windows.Handle
	before *windows.SECURITY_DESCRIPTOR
}

// Ensure is idempotent and does not remove existing ACEs or grant write access.
// Directory grants have no inheritance. Every mutation uses a checked handle;
// a failure restores earlier changes before returning to the installer/updater.
func Ensure(root string) (err error) {
	paths, err := runtimePaths(root)
	if err != nil {
		return err
	}
	sid, err := windows.StringToSid(restrictedPackages)
	if err != nil {
		return err
	}
	var pin runtime.Pinner
	pin.Pin(sid)
	defer pin.Unpin()
	var changed []change
	defer func() {
		for i := len(changed) - 1; i >= 0; i-- {
			c := changed[i]
			if err != nil {
				dacl, _, e := c.before.DACL()
				if e == nil {
					e = windows.SetSecurityInfo(c.handle, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
				}
				if e != nil {
					err = errors.Join(err, fmt.Errorf("restore runtime permissions: %w", e))
				}
			}
			windows.CloseHandle(c.handle)
		}
	}()
	for _, path := range paths {
		h, sd, e := openSecurity(path, false)
		if e != nil {
			return fmt.Errorf("inspect Electron runtime permissions %s: %w", path, e)
		}
		dacl, _, e := sd.DACL()
		if e != nil {
			windows.CloseHandle(h)
			return e
		}
		covered, e := hasReadAccess(dacl, sid)
		windows.CloseHandle(h)
		if e != nil {
			return fmt.Errorf("Electron runtime permissions %s: %w", path, e)
		}
		if covered {
			continue
		}
		h, sd, e = openSecurity(path, true)
		if e != nil {
			return fmt.Errorf("grant Electron runtime read access %s: %w", path, e)
		}
		dacl, _, e = sd.DACL()
		if e != nil {
			windows.CloseHandle(h)
			return e
		}
		covered, e = hasReadAccess(dacl, sid)
		if e != nil || covered {
			windows.CloseHandle(h)
			if e != nil {
				return e
			}
			continue
		}
		merged, e := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{
			AccessPermissions: readExecute, AccessMode: windows.GRANT_ACCESS, Inheritance: windows.NO_INHERITANCE,
			Trustee: windows.TRUSTEE{TrusteeForm: windows.TRUSTEE_IS_SID, TrusteeType: windows.TRUSTEE_IS_WELL_KNOWN_GROUP, TrusteeValue: windows.TrusteeValueFromSID(sid)},
		}}, dacl)
		if e != nil {
			windows.CloseHandle(h)
			return e
		}
		changed = append(changed, change{h, sd})
		if e = windows.SetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, merged, nil); e != nil {
			return fmt.Errorf("write Electron runtime permissions %s: %w", path, e)
		}
	}
	return nil
}

func openSecurity(path string, write bool) (windows.Handle, *windows.SECURITY_DESCRIPTOR, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, nil, err
	}
	access := uint32(windows.READ_CONTROL | windows.FILE_READ_ATTRIBUTES)
	if write {
		access |= windows.WRITE_DAC
	}
	h, err := windows.CreateFile(p, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return 0, nil, err
	}
	fail := func(e error) (windows.Handle, *windows.SECURITY_DESCRIPTOR, error) {
		windows.CloseHandle(h)
		return 0, nil, e
	}
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &info); err != nil {
		return fail(err)
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || (info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 && info.NumberOfLinks > 1) {
		return fail(fmt.Errorf("linked runtime paths are not modified"))
	}
	// Reject ancestor junctions as well as a linked leaf, including a path swapped
	// between enumeration and opening. The verified handle remains the target.
	buffer := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(h, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return fail(err)
	}
	if n >= uint32(len(buffer)) {
		return fail(fmt.Errorf("runtime path too long"))
	}
	actual := strings.TrimPrefix(windows.UTF16ToString(buffer[:n]), `\\?\`)
	if !strings.EqualFold(filepath.Clean(actual), filepath.Clean(path)) {
		return fail(fmt.Errorf("redirected runtime path"))
	}
	sd, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fail(err)
	}
	return h, sd, nil
}

func hasReadAccess(acl *windows.ACL, sid *windows.SID) (bool, error) {
	if acl == nil {
		// Do not turn an unrestricted DACL into a restrictive one.
		return true, nil
	}
	var allowed windows.ACCESS_MASK
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, i, &ace); err != nil {
			return false, err
		}
		if ace.Header.AceFlags&windows.INHERIT_ONLY_ACE != 0 {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE && ace.Header.AceType != windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if !windows.EqualSid((*windows.SID)(unsafe.Pointer(&ace.SidStart)), sid) {
			continue
		}
		mask := ace.Mask
		if mask&windows.GENERIC_ALL != 0 {
			mask |= readExecute
		}
		if mask&windows.GENERIC_READ != 0 {
			mask |= windows.FILE_GENERIC_READ
		}
		if mask&windows.GENERIC_EXECUTE != 0 {
			mask |= windows.FILE_GENERIC_EXECUTE
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE && mask&readExecute != 0 {
			return false, windows.ERROR_ACCESS_DENIED
		}
		if ace.Header.AceType == windows.ACCESS_ALLOWED_ACE_TYPE {
			allowed |= mask
		}
	}
	return allowed&readExecute == readExecute, nil
}
