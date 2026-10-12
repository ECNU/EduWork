package main

import (
	goole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
	"path/filepath"
)

func createDesktopShortcut(target string) error {
	desktop, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
	if err != nil {
		return err
	}
	return saveShortcut(filepath.Join(desktop, identity.Product+".lnk"), target)
}

// Caller owns the UI thread's initialized COM apartment.
func saveShortcut(path, target string) error {
	object, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		return err
	}
	defer object.Release()
	shell, err := object.QueryInterface(goole.IID_IDispatch)
	if err != nil {
		return err
	}
	defer shell.Release()
	value, err := oleutil.CallMethod(shell, "CreateShortcut", path)
	if err != nil {
		return err
	}
	defer value.Clear()
	link := value.ToIDispatch()
	for _, property := range []struct{ name, value string }{
		{"TargetPath", filepath.Join(target, "EduWork-Electron.exe")},
		{"WorkingDirectory", target},
		{"IconLocation", filepath.Join(target, "EduWork-Electron.exe") + ",0"},
		{"Description", identity.Product},
	} {
		result, err := oleutil.PutProperty(link, property.name, property.value)
		if err != nil {
			return err
		}
		result.Clear()
	}
	result, err := oleutil.CallMethod(link, "Save")
	if err == nil {
		result.Clear()
	}
	return err
}
