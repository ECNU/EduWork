package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/portable"
)

func TestCheckInstallationTargetAfterManifestIsRemoved(t *testing.T) {
	target := t.TempDir()
	app := filepath.Join(target, "resources", "app")
	if err := os.MkdirAll(app, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), []byte(`{"shell":"electron","distribution":"eduwork"}`), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(target, "RELEASE-MANIFEST.json")
	contents := `{
		"schemaVersion": 1, "kind": "eduwork-portable-release", "version": "1.2.3",
		"distribution": "eduwork", "shell": "electron", "platform": "windows-x64",
		"files": [{"path": "EduWork-Electron.exe"}, {"path": "resources/app/eduwork.desktop.json"}]
	}`
	if err := os.WriteFile(manifest, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	id := portable.Identity{Distribution: "eduwork"}
	if version, err := checkInstallationTarget(target, id, false); err != nil || version != "1.2.3" {
		t.Fatalf("expected the first check to recognize the installed version, got %q, %v", version, err)
	}
	if err := os.Remove(manifest); err != nil {
		t.Fatal(err)
	}
	if _, err := checkInstallationTarget(target, id, true); err == nil || err.Error() != "清单文件未找到，请彻底卸载后重新安装" {
		t.Fatalf("expected a missing manifest error after confirmation, got %v", err)
	}
	if _, err := checkInstallationTarget(target, id, false); err == nil || err.Error() != "目标目录已存在，请检查安装路径：\n"+target {
		t.Fatalf("expected a directory conflict during the initial check, got %v", err)
	}
}
