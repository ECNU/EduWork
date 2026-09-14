//go:build windows

package updater

import (
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestConfigureDetachedHelperCommandKeepsProgressWindowVisible(t *testing.T) {
	command := exec.Command("cmd.exe", "/c", "exit", "0")
	configureDetachedHelperCommand(command)
	if command.SysProcAttr == nil {
		t.Fatal("update helper has no Windows process attributes")
	}
	if command.SysProcAttr.HideWindow {
		t.Fatal("update helper is hidden; users cannot observe apply progress")
	}
	if command.SysProcAttr.CreationFlags&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatal("update helper must outlive the old desktop process group")
	}
	if command.SysProcAttr.CreationFlags&windows.CREATE_BREAKAWAY_FROM_JOB == 0 {
		t.Fatal("update helper must escape the legacy shortcut launcher's lifetime job")
	}
}
