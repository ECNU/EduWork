package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFreshWebviewCacheDoesNotCreateMigrationDestination(t *testing.T) {
	home := filepath.Join(t.TempDir(), "edition", "dsh")
	if err := os.MkdirAll(startupWebviewPath(home), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Fatalf("browser pre-created DSH home: %v", err)
	}
}

func TestExistingOwnedBrowserCacheIsRetained(t *testing.T) {
	home := filepath.Join(t.TempDir(), "dsh")
	cache := filepath.Join(home, "webview2")
	if err := os.MkdirAll(cache, 0700); err != nil {
		t.Fatal(err)
	}
	if startupWebviewPath(home) == cache {
		t.Fatal("unowned failed-start cache blocks migration")
	}
	if err := os.WriteFile(filepath.Join(home, ".eduwork-desktop-home.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if startupWebviewPath(home) != cache {
		t.Fatal("existing browser preferences were reset")
	}
}

func TestMigrationErrorKeepsProcessFailureWithoutOutput(t *testing.T) {
	cause := errors.New("process executable missing")
	err := migrationFailure(cause, nil)
	if !errors.Is(err, cause) || !strings.Contains(err.Error(), cause.Error()) {
		t.Fatal(err)
	}
	if !strings.Contains(migrationFailure(cause, []byte("detail")).Error(), "detail") {
		t.Fatal("lost process output")
	}
}
