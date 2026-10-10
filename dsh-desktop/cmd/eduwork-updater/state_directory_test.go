package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

func TestServeRejectsRelativeStateDirectory(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "resources", "app")
	if err := os.MkdirAll(app, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), []byte(`{"shell":"electron","productVersion":"0.4.2"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"serve", "--root", root, "--edition", filepath.Join(root, "edition.json"), "--parent-pid", "1", "--state-dir", "relative"}); err == nil {
		t.Fatal("accepted a relative update state directory")
	}
	if _, err := os.Stat(filepath.Join(root, "data")); !os.IsNotExist(err) {
		t.Fatalf("invalid startup created installation state: %v", err)
	}
}

func TestServeSeparatesInstallationAndUserState(t *testing.T) {
	for _, external := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "user"}[external], func(t *testing.T) {
			root := t.TempDir()
			app := filepath.Join(root, "resources", "app")
			if err := os.MkdirAll(app, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(app, "eduwork.desktop.json"), []byte(`{"shell":"electron","productVersion":"0.4.2"}`), 0600); err != nil {
				t.Fatal(err)
			}
			edition := filepath.Join(root, "edition.json")
			if err := os.WriteFile(edition, []byte(`{"schemaVersion":1,"enabled":false,"defaultPolicy":"stable","target":"windows-amd64","flavor":"offline"}`), 0600); err != nil {
				t.Fatal(err)
			}
			state := filepath.Join(root, "data", "state")
			args := []string{"serve", "--root", root, "--edition", edition, "--parent-pid", "1"}
			if external {
				state = filepath.Join(t.TempDir(), "data", "state")
				args = append(args, "--state-dir", state)
			}
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			prior := os.Stdin
			os.Stdin = reader
			defer func() { os.Stdin = prior }()
			if err := run(args); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(state, "update-preferences.json")); err != nil {
				t.Fatal(err)
			}
			if external {
				if _, err := os.Stat(filepath.Join(root, "data")); !os.IsNotExist(err) {
					t.Fatalf("created user state in installation: %v", err)
				}
			}
		})
	}
}

func TestUserStateDoesNotApplyAnotherInstallationPendingUpdate(t *testing.T) {
	state := t.TempDir()
	oldRoot := t.TempDir()
	newRoot := t.TempDir()
	pending := updater.PendingUpdate{SchemaVersion: 1, Version: "0.4.3", State: "ready", InstallDir: oldRoot, InstallOnNextStart: true}
	if err := updater.SavePending(state, pending); err != nil {
		t.Fatal(err)
	}
	if err := cancelForeignPending(state, oldRoot); err != nil {
		t.Fatal(err)
	}
	if unchanged, err := updater.LoadPending(state); err != nil || unchanged.State != "ready" {
		t.Fatalf("cancelled the current installation's update: %#v, %v", unchanged, err)
	}
	if err := cancelForeignPending(state, newRoot); err != nil {
		t.Fatal(err)
	}
	cancelled, err := updater.LoadPending(state)
	if err != nil || cancelled.State != "cancelled" || cancelled.InstallOnNextStart || cancelled.InstallDir != oldRoot {
		t.Fatalf("foreign pending update was not retained and cancelled: %#v, %v", cancelled, err)
	}
}
