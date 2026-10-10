package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeAccessRequiresElectronIdentity(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "resources", "app")
	if err := os.MkdirAll(app, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "EduWork-Electron.exe"), []byte("synthetic runtime"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, identity := range []string{`{}`, `{"schemaVersion":1,"shell":"wails"}`, `{"schemaVersion":2,"shell":"electron"}`, `invalid JSON`} {
		if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), []byte(identity), 0600); err != nil {
			t.Fatal(err)
		}
		if err := run([]string{"ensure-runtime-access", "--root", root}); err == nil {
			t.Fatalf("accepted identity %s", identity)
		}
	}
	if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), []byte(`{"schemaVersion":1,"shell":"electron"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"ensure-runtime-access", "--root", root}); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"ensure-runtime-access"}, {"ensure-runtime-access", "--root", "."}, {"ensure-runtime-access", "--root", root, "unexpected"}} {
		if err := run(args); err == nil {
			t.Fatalf("accepted arguments %v", args)
		}
	}
}
