package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBridgeHealthCompatibleAndConfined(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "data/state/updates/transactions/0.3.0/health.ok")
	got, err := validateBridgeHealth(root, path)
	if err != nil || got != path {
		t.Fatal(got, err)
	}
	if err = bridgeHealth(path, "ready", ""); err != nil {
		t.Fatal(err)
	}
	bytes, _ := os.ReadFile(path)
	if string(bytes) != "ok\n" {
		t.Fatalf("legacy helper cannot read %q", bytes)
	}
	for _, bad := range []string{filepath.Join(root, "health.ok"), filepath.Join(root, "data/state/updates/transactions/health.ok"), filepath.Join(root, "data/state/updates/transactions/0.3.0/other.txt"), "health.ok"} {
		if _, err = validateBridgeHealth(root, bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
