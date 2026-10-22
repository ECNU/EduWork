package main

import (
	"fmt"
	"path/filepath"
	"syscall"
	"unsafe"

	goole "github.com/go-ole/go-ole"
	"golang.org/x/sys/windows"
)

// IShellLinkW and IPersistFile ABI from the Windows SDK's ShObjIdl_core.h
// and ObjIdl.h. Use the native Shell API rather than the WScript automation host.
type shellLinkVTable struct {
	goole.IUnknownVtbl
	GetPath, GetIDList, SetIDList            uintptr
	GetDescription, SetDescription           uintptr
	GetWorkingDirectory, SetWorkingDirectory uintptr
	GetArguments, SetArguments               uintptr
	GetHotkey, SetHotkey                     uintptr
	GetShowCmd, SetShowCmd                   uintptr
	GetIconLocation, SetIconLocation         uintptr
	SetRelativePath, Resolve, SetPath        uintptr
}
type persistFileVTable struct {
	goole.IUnknownVtbl
	GetClassID, IsDirty, Load, Save, SaveCompleted, GetCurFile uintptr
}

var shellLinkClass = goole.NewGUID("{00021401-0000-0000-C000-000000000046}")
var shellLinkInterface = goole.NewGUID("{000214F9-0000-0000-C000-000000000046}")
var persistFileInterface = goole.NewGUID("{0000010B-0000-0000-C000-000000000046}")

func shortcutResult(operation string, result uintptr) error {
	if int32(result) < 0 {
		return fmt.Errorf("%s: %w", operation, goole.NewError(result))
	}
	return nil
}

func createDesktopShortcut(target string) error {
	desktop, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
	if err != nil {
		return err
	}
	return saveShortcut(filepath.Join(desktop, identity.Product+".lnk"), target)
}

// Caller owns the UI thread's initialized COM apartment.
func saveShortcut(path, target string) error {
	target, err := filepath.EvalSymlinks(target)
	if err != nil {
		return err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return err
	}
	path = filepath.Join(parent, filepath.Base(path))
	object, err := goole.CreateInstance(shellLinkClass, shellLinkInterface)
	if err != nil {
		return err
	}
	defer object.Release()
	methods := (*shellLinkVTable)(unsafe.Pointer(object.RawVTable))
	for _, property := range []struct {
		name   string
		method uintptr
		value  string
	}{
		{"target", methods.SetPath, filepath.Join(target, "EduWork-Electron.exe")},
		{"working directory", methods.SetWorkingDirectory, target},
		{"description", methods.SetDescription, identity.Product},
	} {
		value, err := windows.UTF16PtrFromString(property.value)
		if err != nil {
			return err
		}
		result, _, _ := syscall.SyscallN(property.method, uintptr(unsafe.Pointer(object)), uintptr(unsafe.Pointer(value)))
		if err := shortcutResult("set shortcut "+property.name, result); err != nil {
			return err
		}
	}
	icon, err := windows.UTF16PtrFromString(filepath.Join(target, "EduWork-Electron.exe"))
	if err != nil {
		return err
	}
	result, _, _ := syscall.SyscallN(methods.SetIconLocation, uintptr(unsafe.Pointer(object)), uintptr(unsafe.Pointer(icon)), 0)
	if err := shortcutResult("set shortcut icon", result); err != nil {
		return err
	}
	persist, err := object.QueryInterface(persistFileInterface)
	if err != nil {
		return err
	}
	defer persist.Release()
	persistence := (*persistFileVTable)(unsafe.Pointer(persist.RawVTable))
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	result, _, _ = syscall.SyscallN(persistence.Save, uintptr(unsafe.Pointer(persist)), uintptr(unsafe.Pointer(name)), 1)
	return shortcutResult("save shortcut", result)
}
