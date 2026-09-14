// The stable legacy shortcut target. It contains no update logic or user data.
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func main() {
	self, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	root := filepath.Dir(self)
	target := filepath.Join(root, "EduWork.exe")
	args := os.Args[1:]
	_, electron := os.Stat(filepath.Join(root, "resources", "app", "eduwork.desktop.json"))
	_, wails := os.Stat(filepath.Join(root, "eduwork.desktop.json"))
	if electron == nil || wails != nil {
		target = filepath.Join(root, "EduWork-Electron.exe")
		if len(args) > 0 && args[0] == "run" {
			args = args[1:]
		}
	}
	// Both historic executable names can be shortcut targets in an Electron
	// release. A partial extraction must fail rather than relaunch this shim.
	if targetInfo, targetErr := os.Stat(target); targetErr != nil {
		os.Exit(1)
	} else if selfInfo, selfErr := os.Stat(self); selfErr != nil || os.SameFile(selfInfo, targetInfo) {
		os.Exit(1)
	}
	child := exec.Command(target, args...)
	child.Dir = root
	// GUI child must not inherit SW_HIDE; its own startup window remains visible.
	child.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200} // CREATE_NEW_PROCESS_GROUP
	// Keep the shim alive for old helpers that watch the launched process while
	// waiting for the real application's health marker.
	if err = runChild(child); err != nil {
		if e, ok := err.(*exec.ExitError); ok {
			os.Exit(e.ExitCode())
		}
		os.Exit(1)
	}
}
