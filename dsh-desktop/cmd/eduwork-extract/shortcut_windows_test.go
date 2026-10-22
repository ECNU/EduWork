package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"unsafe"

	goole "github.com/go-ole/go-ole"
	"golang.org/x/sys/windows"
)

func TestShortcutUnicodeTarget(t *testing.T) {
	for _, mode := range []string{"long", "short"} {
		t.Run(mode, func(t *testing.T) {
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()
			if err := goole.CoInitializeEx(0, goole.COINIT_APARTMENTTHREADED); err != nil {
				t.Fatal(err)
			}
			defer goole.CoUninitialize()
			root := t.TempDir()
			if mode == "short" {
				wide, _ := windows.UTF16PtrFromString(root)
				buffer := make([]uint16, 32768)
				n, err := windows.GetShortPathName(wide, &buffer[0], uint32(len(buffer)))
				if err != nil || n == 0 || n >= uint32(len(buffer)) {
					t.Fatalf("short path: %d (%v)", n, err)
				}
				root = windows.UTF16ToString(buffer[:n])
			}
			target := filepath.Join(root, "安装 目录")
			if err := os.Mkdir(target, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "测试快捷方式.lnk")
			if err := saveShortcut(path, target); err != nil {
				t.Fatal(err)
			}
			canonical, err := filepath.EvalSymlinks(target)
			if err != nil {
				t.Fatal(err)
			}
			object, err := goole.CreateInstance(shellLinkClass, shellLinkInterface)
			if err != nil {
				t.Fatal(err)
			}
			defer object.Release()
			persist, err := object.QueryInterface(persistFileInterface)
			if err != nil {
				t.Fatal(err)
			}
			defer persist.Release()
			persistence := (*persistFileVTable)(unsafe.Pointer(persist.RawVTable))
			name, _ := windows.UTF16PtrFromString(path)
			result, _, _ := syscall.SyscallN(persistence.Load, uintptr(unsafe.Pointer(persist)), uintptr(unsafe.Pointer(name)), 0)
			if err := shortcutResult("load shortcut", result); err != nil {
				t.Fatal(err)
			}
			methods := (*shellLinkVTable)(unsafe.Pointer(object.RawVTable))
			for _, property := range []struct {
				name     string
				method   uintptr
				expected string
			}{
				{"target", methods.GetPath, filepath.Join(canonical, "EduWork-Electron.exe")},
				{"working directory", methods.GetWorkingDirectory, canonical},
			} {
				buffer := make([]uint16, 32768)
				if property.name == "target" {
					result, _, _ = syscall.SyscallN(property.method, uintptr(unsafe.Pointer(object)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0, 4)
				} else {
					result, _, _ = syscall.SyscallN(property.method, uintptr(unsafe.Pointer(object)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
				}
				if err := shortcutResult("read "+property.name, result); err != nil {
					t.Fatal(err)
				}
				actual := windows.UTF16ToString(buffer)
				if !strings.EqualFold(actual, property.expected) {
					t.Fatalf("%s: got %q want %q", property.name, actual, property.expected)
				}
			}
		})
	}
}
