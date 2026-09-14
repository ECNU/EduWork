package updater

import (
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var migrationTestHandoff = flag.String("eduwork-migration", "", "test child migration handoff")

func TestMain(m *testing.M) {
	flag.Parse()
	// The Electron transaction test uses this test binary as a tiny desktop
	// stand-in, exercising the real child launch/health protocol without UI.
	if exe, _ := os.Executable(); strings.EqualFold(filepath.Base(exe), "EduWork-Electron.exe") && *updaterTestHealthFile != "" && *migrationTestHandoff == "" {
		if _, err := os.Stat(filepath.Join(filepath.Dir(exe), "fail-electron")); err == nil {
			os.Exit(23)
		}
		if os.WriteFile(*updaterTestHealthFile, []byte("ok\n"), 0600) != nil {
			os.Exit(24)
		}
		os.Exit(0)
	}
	if *migrationTestHandoff != "" {
		data, err := os.ReadFile(*migrationTestHandoff)
		if err != nil {
			os.Exit(21)
		}
		var handoff map[string]any
		if json.Unmarshal(data, &handoff) != nil || handoff["kind"] != "legacy-wails-v1" {
			os.Exit(22)
		}
		exe, _ := os.Executable()
		if _, err = os.Stat(filepath.Join(filepath.Dir(exe), "fail-migration")); err == nil {
			os.Exit(23)
		}
		_ = os.WriteFile(filepath.Join(filepath.Dir(exe), "migration-observed.json"), data, 0600)
		if os.WriteFile(*updaterTestHealthFile, []byte("ok\n"), 0600) != nil {
			os.Exit(24)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestElectronMigrationRequiresExplicitBridgeAndLaunchIdentity(t *testing.T) {
	m := releaseManifest{Launch: &releaseLaunch{Protocol: "eduwork-desktop/v1", Shell: "electron", Migration: "legacy-wails-v1", Executable: "EduWork-Electron.exe", Distribution: "eduwork-chatecnu"}, Files: []releaseFile{{Path: "EduWork-Electron.exe"}, {Path: "resources/app/eduwork.desktop.json"}}}
	p := PendingUpdate{TargetShell: "electron", AllowShellMigration: true}
	if err := validateReleaseLaunch(p, m); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []PendingUpdate{{TargetShell: "electron"}, {AllowShellMigration: true}, {TargetShell: "other", AllowShellMigration: true}} {
		if validateReleaseLaunch(bad, m) == nil {
			t.Fatal("accepted unqualified shell migration")
		}
	}
	m.Launch.Executable = "../arbitrary.exe"
	if validateReleaseLaunch(p, m) == nil {
		t.Fatal("accepted arbitrary executable")
	}
}

func TestGoToElectronTransactionPreservesConfigDataAndRollsBackFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			fixture := newApplyFixture(t, "0.3.0", "healthy")
			p, err := LoadPending(fixture.stateDir)
			if err != nil {
				t.Fatal(err)
			}
			p.TargetShell = "electron"
			p.AllowShellMigration = true
			writeFixtureFile(t, filepath.Join(fixture.installDir, "data/dsh/sessions/old.json"), []byte("history"))
			writeFixtureFile(t, filepath.Join(fixture.installDir, "config/eduwork.jsonc"), []byte("user configuration"))
			exe, _ := os.Executable()
			payload, _ := os.ReadFile(exe)
			files := map[string][]byte{"EduWork-Electron.exe": payload, "resources/app/eduwork.desktop.json": []byte(`{"schemaVersion":1}`), "config/eduwork.jsonc": []byte("default must not overwrite"), "config/examples/new.jsonc": []byte("example")}
			if fail {
				files["fail-migration"] = []byte("fail")
			}
			m := releaseManifest{SchemaVersion: 1, LauncherVersion: p.Version, Flavor: "offline", Launch: &releaseLaunch{Protocol: "eduwork-desktop/v1", Shell: "electron", Executable: "EduWork-Electron.exe", Migration: "legacy-wails-v1", Distribution: "eduwork-chatecnu"}}
			for name, bytes := range files {
				m.Files = append(m.Files, releaseFile{Path: name, Bytes: int64(len(bytes)), SHA256: fmt.Sprintf("%x", sha256.Sum256(bytes))})
			}
			archive := writeReleaseZIP(t, m, files)
			zipBytes, _ := os.ReadFile(archive)
			writeFixtureFile(t, p.ZIPPath, zipBytes)
			p.SHA256 = fmt.Sprintf("%x", sha256.Sum256(zipBytes))
			if err = SavePending(fixture.stateDir, p); err != nil {
				t.Fatal(err)
			}
			// Internal entry exercises replacement/health/rollback without launching an
			// extra copy of the restored old fixture after a deliberate failure.
			err = applyAndRestart(fixture.stateDir, p, nil)
			if fail {
				if err == nil || !strings.Contains(err.Error(), "health") {
					t.Fatalf("missing failed handshake: %v", err)
				}
				assertFileValue(t, filepath.Join(fixture.installDir, "resources/version.txt"), "old-version")
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if _, err = os.Stat(filepath.Join(fixture.installDir, "migration-observed.json")); err != nil {
					t.Fatal(err)
				}
			}
			assertFileValue(t, filepath.Join(fixture.installDir, "config/eduwork.jsonc"), "user configuration")
			assertFileValue(t, filepath.Join(fixture.installDir, "data/dsh/sessions/old.json"), "history")
		})
	}
}

func TestMigrationRefusesExternalLegacyHomeBeforeReplacingAnything(t *testing.T) {
	root := t.TempDir()
	m := releaseManifest{Launch: &releaseLaunch{Protocol: "eduwork-desktop/v1", Shell: "electron", Executable: "EduWork-Electron.exe", Migration: "legacy-wails-v1", Distribution: "eduwork"}, Files: []releaseFile{{Path: "EduWork-Electron.exe"}, {Path: "resources/app/eduwork.desktop.json"}}}
	_, _, err := prepareReleaseLaunch(filepath.Join(root, "other/state"), root, PendingUpdate{InstallDir: root, TargetShell: "electron", AllowShellMigration: true}, m)
	if err == nil || !strings.Contains(err.Error(), "custom data") {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestBridgeSelectsLiveWailsHomeAndRejectsOtherEdition(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "data/eduwork-chatecnu-wails/dsh")
	state := filepath.Join(root, "data/state")
	transaction := filepath.Join(state, "updates/transactions/0.3.1")
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(transaction, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "eduwork.desktop.json"), []byte(`{"shell":"wails","distribution":"eduwork-chatecnu"}`), 0600); err != nil {
		t.Fatal(err)
	}
	m := releaseManifest{Launch: &releaseLaunch{Protocol: "eduwork-desktop/v1", Shell: "electron", Executable: "EduWork-Electron.exe", Migration: "wails-host-v1", Distribution: "eduwork-chatecnu"}, Files: []releaseFile{{Path: "EduWork-Electron.exe"}, {Path: "resources/app/eduwork.desktop.json"}}}
	p := PendingUpdate{InstallDir: root, TargetShell: "electron", AllowShellMigration: true, Version: "0.3.1"}
	_, args, err := prepareReleaseLaunch(state, transaction, p, m)
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := os.ReadFile(args[1])
	var handoff map[string]any
	_ = json.Unmarshal(bytes, &handoff)
	if handoff["sourceHome"] != home || handoff["kind"] != "wails-host-v1" {
		t.Fatalf("wrong source: %s", bytes)
	}
	m.Launch.Distribution = "other"
	if _, _, err = prepareReleaseLaunch(state, transaction, p, m); err == nil {
		t.Fatal("accepted another edition")
	}
	m.Launch.Distribution = "eduwork-chatecnu"
	m.Launch.Migration = "legacy-wails-v1"
	if _, _, err = prepareReleaseLaunch(state, transaction, p, m); err == nil {
		t.Fatal("accepted stale legacy snapshot")
	}
}
