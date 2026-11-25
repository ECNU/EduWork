//go:build windows

package updater

import (
	"crypto/sha256"
	"crypto/sha512"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPortableMigrationInstallerVerification(t *testing.T) {
	cache, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	version := "0.4.15"
	directory := filepath.Join(cache, "installer-synthetic")
	path := filepath.Join(directory, "EduWork-Setup-"+version+"-x64.exe")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	data := []byte("synthetic installer")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if !migrationInstallerPath(cache, path, "EduWork", version) || migrationInstallerPath(cache, path, "EduWork", "0.4.16") || migrationInstallerPath(directory, path, "EduWork", version) {
		t.Fatal("installer is not bound to its edition, version, architecture and cache")
	}
	for algorithm, digest := range map[string]string{"sha256": fmt.Sprintf("%x", sha256.Sum256(data)), "sha512": fmt.Sprintf("%x", sha512.Sum512(data))} {
		file, err := verifyMigrationInstaller(path, algorithm, digest, int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(path); err == nil {
			t.Fatal("verified path can be replaced before launch")
		}
		file.Close()
		if file, err := verifyMigrationInstaller(path, algorithm, digest, int64(len(data)+1)); err == nil {
			file.Close()
			t.Fatal("installer with wrong size was accepted")
		}
		if file, err := verifyMigrationInstaller(path, algorithm, strings.Repeat("0", len(digest)), int64(len(data))); err == nil {
			file.Close()
			t.Fatal("installer with wrong checksum was accepted")
		}
	}
}

func TestPortableMigrationLaunchStripsSourceEnvironment(t *testing.T) {
	command := exec.Command("EduWork-Electron.exe")
	command.Env = []string{"DSH_HOME=source", "dsh_desktop_diagnostic_file=source", "EDUWORK_CONFIG_FILE=source", "EDUWORK_LAUNCHER_RESTART=1", "LOCALAPPDATA=target"}
	configureMigrationAppCommand(command)
	for _, entry := range command.Env {
		if entry != "LOCALAPPDATA=target" && !strings.HasPrefix(strings.ToUpper(entry), "SYSTEMROOT=") {
			t.Fatalf("unexpected environment: %v", command.Env)
		}
	}
}

func TestPortableMigrationInstalledIdentity(t *testing.T) {
	local, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(local, "Programs", "EduWork", "eduwork")
	app := filepath.Join(root, "resources", "app")
	if err := os.MkdirAll(app, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(root, "EduWork-Electron.exe")
	if err := os.WriteFile(executable, []byte("synthetic"), 0o600); err != nil {
		t.Fatal(err)
	}
	identity := migrationIdentity{SchemaVersion: 1, Shell: "electron", DataLayout: "installed", Distribution: "eduwork", AppID: "org.eduwork.eduwork.electron", ProductVersion: "0.4.15"}
	writeIdentity := func() {
		data, err := json.Marshal(identity)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeIdentity()
	for _, minimum := range []string{"", "0.4.14", "0.4.15"} {
		if resolved, err := installedMigrationExecutable(local, "eduwork", minimum); err != nil || resolved != executable {
			t.Fatalf("unexpected installed executable %q: %v", resolved, err)
		}
	}
	if _, err := installedMigrationExecutable(local, "eduwork", "0.4.16"); err == nil {
		t.Fatal("accepted an older installed version")
	}
	identity.AppID = "org.eduwork.other.electron"
	writeIdentity()
	if _, err := installedMigrationExecutable(local, "eduwork", ""); err == nil {
		t.Fatal("accepted another installed identity")
	}
	identity.AppID = "org.eduwork.eduwork.electron"
	writeIdentity()
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
	if _, err := installedMigrationExecutable(local, "eduwork", ""); err == nil {
		t.Fatal("accepted a missing installed executable")
	}
}
