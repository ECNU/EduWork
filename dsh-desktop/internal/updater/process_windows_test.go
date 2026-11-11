//go:build windows

package updater

import (
	"os/exec"
	"strings"
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

func TestConfigureDetachedAppCommandDoesNotClaimLauncherOwnership(t *testing.T) {
	t.Setenv("EDUWORK_LAUNCHER_RESTART", "1")
	for _, explicit := range []bool{false, true} {
		command := exec.Command("cmd.exe", "/c", "exit", "0")
		if explicit {
			command.Env = []string{"eduwork_launcher_restart=1", "UPDATER_TEST_KEEP=present"}
		} else {
			t.Setenv("UPDATER_TEST_KEEP", "present")
		}
		configureDetachedAppCommand(command)
		kept := false
		for _, entry := range command.Env {
			name, value, _ := strings.Cut(entry, "=")
			if strings.EqualFold(name, "EDUWORK_LAUNCHER_RESTART") {
				t.Fatal("direct updater launch inherited legacy launcher ownership")
			}
			if name == "UPDATER_TEST_KEEP" && value == "present" {
				kept = true
			}
		}
		if !kept {
			t.Fatal("direct updater launch lost an unrelated environment value")
		}
	}
}
