package main

import (
	goole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestShortcutUnicodeTarget(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := goole.CoInitializeEx(0, goole.COINIT_APARTMENTTHREADED); err != nil {
		t.Fatal(err)
	}
	defer goole.CoUninitialize()
	root := t.TempDir()
	target := filepath.Join(root, "安装 目录")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "测试快捷方式.lnk")
	if err := saveShortcut(path, target); err != nil {
		t.Fatal(err)
	}
	object, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		t.Fatal(err)
	}
	defer object.Release()
	shell, err := object.QueryInterface(goole.IID_IDispatch)
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Release()
	value, err := oleutil.CallMethod(shell, "CreateShortcut", path)
	if err != nil {
		t.Fatal(err)
	}
	defer value.Clear()
	for _, property := range []struct{ name, expected string }{{"TargetPath", filepath.Join(target, "EduWork-Electron.exe")}, {"WorkingDirectory", target}} {
		result, err := oleutil.GetProperty(value.ToIDispatch(), property.name)
		if err != nil {
			t.Fatal(err)
		}
		actual := result.ToString()
		result.Clear()
		if actual != property.expected {
			t.Fatalf("%s: got %q want %q", property.name, actual, property.expected)
		}
	}
}
