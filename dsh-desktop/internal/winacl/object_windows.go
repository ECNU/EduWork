//go:build windows

// Package winacl opens checked local objects and changes only their DACL.
package winacl

import (
	"fmt"
	"golang.org/x/sys/windows"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"
)

var ntSetSecurityObject = windows.NewLazySystemDLL("ntdll.dll").NewProc("NtSetSecurityObject")

// Update only the checked object. SetSecurityInfo also recalculates inherited
// child ACLs, even when the new ACE itself has NO_INHERITANCE. The native call
// keeps unrelated children untouched and works on an already running EXE.
func SetDACL(handle windows.Handle, sd *windows.SECURITY_DESCRIPTOR) error {
	control, _, err := sd.Control()
	if err != nil {
		return err
	}
	// The native setter consumes AUTO_INHERIT_REQ to preserve AUTO_INHERITED.
	// Unlike the Win32 tree helper, it does not enumerate child objects.
	if control&windows.SE_SELF_RELATIVE != 0 {
		sd, err = sd.ToAbsolute()
		if err != nil {
			return err
		}
	}
	request, err := sd.ToSelfRelative()
	if err != nil {
		return err
	}
	flags := windows.SECURITY_DESCRIPTOR_CONTROL(0)
	if control&windows.SE_DACL_AUTO_INHERITED != 0 {
		flags = windows.SE_DACL_AUTO_INHERIT_REQ
	}
	if err = request.SetControl(windows.SE_DACL_AUTO_INHERIT_REQ, flags); err != nil {
		return err
	}
	status, _, _ := ntSetSecurityObject.Call(uintptr(handle), uintptr(windows.DACL_SECURITY_INFORMATION), uintptr(unsafe.Pointer(request)))
	runtime.KeepAlive(request)
	if status != 0 {
		return windows.NTStatus(status).Errno()
	}
	return nil
}

func Open(path string, write bool) (windows.Handle, *windows.SECURITY_DESCRIPTOR, error) {
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
		return fail(fmt.Errorf("linked ACL paths are not modified"))
	}
	// Reject ancestor junctions as well as a linked leaf, including a path swapped
	// between enumeration and opening. The verified handle remains the target.
	buffer := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(h, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return fail(err)
	}
	if n >= uint32(len(buffer)) {
		return fail(fmt.Errorf("ACL path too long"))
	}
	actual := strings.TrimPrefix(windows.UTF16ToString(buffer[:n]), `\\?\`)
	if !strings.EqualFold(filepath.Clean(actual), filepath.Clean(path)) {
		// GetFinalPathNameByHandle returns long names, while TEMP and installed
		// paths can use 8.3 aliases (e.g. RUNNER~1). Expand only those names;
		// unlike EvalSymlinks this does not accept a redirected ancestor.
		n, err = windows.GetLongPathName(p, &buffer[0], uint32(len(buffer)))
		if err != nil {
			return fail(err)
		}
		if n >= uint32(len(buffer)) {
			return fail(fmt.Errorf("ACL path too long"))
		}
		expected := strings.TrimPrefix(windows.UTF16ToString(buffer[:n]), `\\?\`)
		if !strings.EqualFold(filepath.Clean(actual), filepath.Clean(expected)) {
			return fail(fmt.Errorf("redirected ACL path"))
		}
	}
	sd, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil {
		return fail(err)
	}
	return h, sd, nil
}
