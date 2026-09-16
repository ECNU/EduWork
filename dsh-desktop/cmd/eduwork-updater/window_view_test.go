package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeInstallerPending(t *testing.T, path, root string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"version": "0.4.0-dev.1", "installDir": root})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestInstallerStagesFollowTransactionOrder(t *testing.T) {
	last := 0
	for _, stage := range []string{"waiting", "verify-package", "extract", "verify-files", "replace", "runtime", "launch", "health", "cleanup", "done"} {
		current := installerStage(stage)
		if current < last {
			t.Fatalf("stage moved backwards: %s", stage)
		}
		last = current
	}
}

func TestInstallerIdentityUsesPendingVersionAndInstalledBrand(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "resources/app"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "resources/app/eduwork.desktop.json"), []byte(`{"productName":"EduWork@Example"}`), 0600); err != nil {
		t.Fatal(err)
	}
	pending := filepath.Join(root, "pending.json")
	// Include Windows paths without losing backslashes to JSON escaping.
	writeInstallerPending(t, pending, root)
	identity := readInstallerIdentity(pending)
	if identity.Name != "EduWork@Example" || identity.Version != "0.4.0-dev.1" {
		t.Fatalf("unexpected identity: %+v", identity)
	}
	if readInstallerIdentity(filepath.Join(root, "missing.json")).Name != "EduWork" {
		t.Fatal("missing metadata needs safe product name")
	}
}
