package updatecontrol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

func TestAssemblyDefaultSurvivesUpgradeAndPreservesUserChoice(t *testing.T) {
	for _, policy := range []string{"development", "stable"} {
		t.Run(policy, func(t *testing.T) {
			root := t.TempDir()
			config := Config{Version: "0.3.5-dev.20260913.1", DefaultPolicy: policy, EditionPath: writeEdition(t, root, "stable"), StateDir: filepath.Join(root, "state")}
			manager, err := New(config)
			if err != nil || manager.Status().Policy != policy {
				t.Fatalf("assembly default: %v %v", manager, err)
			}
			data, _ := os.ReadFile(manager.preferencesPath())
			var saved preferences
			if json.Unmarshal(data, &saved) != nil || saved.Source != "packaged-default" {
				t.Fatalf("missing default provenance: %s", data)
			}
			config.Version = "0.3.5"
			config.DefaultPolicy = "stable"
			upgraded, err := New(config)
			if err != nil || upgraded.Status().Policy != policy {
				t.Fatalf("Go/Electron upgrade changed origin policy: %v", err)
			}
			if _, err = upgraded.SetPolicy("stable"); err != nil {
				t.Fatal(err)
			}
			config.DefaultPolicy = "development"
			reloaded, err := New(config)
			if err != nil || reloaded.Status().Policy != "stable" {
				t.Fatalf("user choice overwritten: %v", err)
			}
		})
	}
}

func TestLegacyExplicitPreferenceWinsOverNewAssembly(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "update-preferences.json"), []byte(`{"schemaVersion":1,"policy":"development"}`), 0600); err != nil {
		t.Fatal(err)
	}
	m, err := New(Config{Version: "0.3.5", DefaultPolicy: "stable", EditionPath: writeEdition(t, root, "stable"), StateDir: root})
	if err != nil || m.Status().Policy != "development" {
		t.Fatalf("lost 0.2 channel: %v", err)
	}
}

func writeEdition(t *testing.T, root, policy string) string {
	t.Helper()
	path := filepath.Join(root, "update.json")
	payload := `{"schemaVersion":1,"manifestBaseURL":"https://updates.example.test/chatecnu-work/releases","defaultPolicy":"` + policy + `","target":"windows-amd64","flavor":"offline"}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestManagerAllowsExplicitlyDisabledPublicEdition(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "update.json")
	payload := `{"schemaVersion":1,"enabled":false,"manifestBaseURL":"","defaultPolicy":"stable","target":"windows-amd64","flavor":"online"}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(Config{Version: "0.2.0", EditionPath: path, StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); status.Enabled || status.State != "disabled" {
		t.Fatalf("disabled status = %#v", status)
	}
	manager.AutoCheck()
	if _, err := manager.Check(t.Context()); err == nil {
		t.Fatal("expected manual check to explain that updates are not configured")
	}
}

func TestBackgroundChecksPreserveAnActiveDownload(t *testing.T) {
	root := t.TempDir()
	manager, err := New(Config{Version: "0.3.3", EditionPath: writeEdition(t, root, "stable"), StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	manager.state = "downloading"
	manager.download = updater.DownloadStatus{DownloadedBytes: 500, TotalBytes: 1000}
	snapshot, err := manager.Check(t.Context())
	if err != nil || snapshot.State != "downloading" || snapshot.DownloadedBytes != 500 {
		t.Fatalf("background check discarded download: %#v, %v", snapshot, err)
	}
}

func TestNewerInstalledVersionDoesNotOfferCachedOlderDownload(t *testing.T) {
	root := t.TempDir()
	p := updater.PendingUpdate{SchemaVersion: 1, Version: "0.3.2", Channel: "stable", Flavor: "offline", ZIPPath: filepath.Join(root, "updates", "old.zip"), InstallDir: root, ExecutableName: "EduWork.exe", State: "ready", InstallOnNextStart: true}
	if err := updater.SavePending(root, p); err != nil {
		t.Fatal(err)
	}
	manager, err := New(Config{Version: "0.3.3", EditionPath: writeEdition(t, root, "stable"), StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if manager.Status().State != "idle" {
		t.Fatal("offered cached downgrade")
	}
	if _, err := updater.LoadPending(root); !os.IsNotExist(err) {
		t.Fatal("stale scheduled receipt remains")
	}
}

func TestManagerDefaultsToDevelopmentAndPersistsChoice(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "state")
	config := Config{
		Version: "0.2.0-dev.1", EditionPath: writeEdition(t, root, "development"),
		StateDir: state, InstallDir: root, ExecutableName: "ChatECNU-Work.exe",
	}
	manager, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if got := manager.Status(); got.Policy != "development" || got.State != "idle" {
		t.Fatalf("unexpected initial status: %#v", got)
	}
	if _, err := manager.SetPolicy("stable"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.Status(); got.Policy != "stable" {
		t.Fatalf("persisted policy=%q", got.Policy)
	}
}

func TestManagerRejectsInvalidEditionAndPolicy(t *testing.T) {
	root := t.TempDir()
	path := writeEdition(t, root, "nightly")
	if _, err := New(Config{Version: "0.2.0", EditionPath: path, StateDir: root}); err == nil {
		t.Fatal("expected invalid edition to fail")
	}
	path = writeEdition(t, root, "development")
	manager, err := New(Config{Version: "0.2.0", EditionPath: path, StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetPolicy("nightly"); err == nil {
		t.Fatal("expected invalid policy to fail")
	}
}

func TestChangingChannelClearsOffersButCannotInterruptVerifiedDownloads(t *testing.T) {
	root := t.TempDir()
	manager, err := New(Config{Version: "0.3.5-dev.20260912.1", EditionPath: writeEdition(t, root, "development"), StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	manager.state = "available"
	manager.status = updater.Status{LatestVersion: "0.3.6-dev.20260913.1"}
	status, err := manager.SetPolicy("stable")
	if err != nil || status.Policy != "stable" || status.LatestVersion != "" || status.State != "idle" {
		t.Fatalf("stale offer: %#v, %v", status, err)
	}
	for _, state := range []string{"checking", "downloading", "ready", "applying"} {
		manager.state = state
		if _, err = manager.SetPolicy("development"); err == nil {
			t.Fatalf("switched during %s", state)
		}
		if manager.policy != "stable" {
			t.Fatal("changed saved policy")
		}
	}
}

func TestManagerSchedulesVerifiedUpdateAndReportsRelaunch(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "state")
	pending := updater.PendingUpdate{
		SchemaVersion: 1, Version: "0.2.0-dev.20260815.9", Channel: "development", Flavor: "offline",
		ZIPPath: filepath.Join(state, "updates", "downloads", "release.zip"), InstallDir: root,
		ExecutableName: "ChatECNU-Work.exe", State: "ready",
	}
	if err := updater.SavePending(state, pending); err != nil {
		t.Fatal(err)
	}
	manager, err := New(Config{
		Version: "0.2.0-dev.20260815.8", EditionPath: writeEdition(t, root, "development"),
		StateDir: state, InstallDir: root, ExecutableName: "ChatECNU-Work.exe",
	})
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.ScheduleNextStart()
	if err != nil || !status.InstallOnNextStart || status.State != "ready" {
		t.Fatalf("scheduled status = %#v, %v", status, err)
	}

	health := filepath.Join(state, "updates", "transactions", "0.2.0-dev.20260815.9", "health.ok")
	relaunched, err := New(Config{
		Version: "0.2.0-dev.20260815.9", EditionPath: writeEdition(t, root, "development"),
		StateDir: filepath.Join(root, "fresh-state"), InstallDir: root, ExecutableName: "ChatECNU-Work.exe",
		UpdateHealthFile: health,
	})
	if err != nil {
		t.Fatal(err)
	}
	if status := relaunched.Status(); status.State != "installed" || status.RelaunchedVersion != "0.2.0-dev.20260815.9" {
		t.Fatalf("relaunched status = %#v", status)
	}
}
