//go:build windows

package electronaccess

import (
	"errors"
	"fmt"
	"runtime"
	"unsafe"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/winacl"
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
				e := winacl.SetDACL(c.handle, c.before)
				if e != nil {
					err = errors.Join(err, fmt.Errorf("restore runtime permissions: %w", e))
				}
			}
			windows.CloseHandle(c.handle)
		}
	}()
	for _, path := range paths {
		h, sd, e := winacl.Open(path, false)
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
		h, sd, e = winacl.Open(path, true)
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
		updated, e := sd.ToAbsolute()
		if e != nil {
			return e
		}
		if e = updated.SetDACL(merged, true, false); e != nil {
			return e
		}
		if e = winacl.SetDACL(h, updated); e != nil {
			return fmt.Errorf("write Electron runtime permissions %s: %w", path, e)
		}
		runtime.KeepAlive(merged)
	}
	return nil
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
