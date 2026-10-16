package updater

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

const deltaTestVersion = "0.4.4"

func deltaManifest(files map[string][]byte) releaseManifest {
	manifest := releaseManifest{SchemaVersion: 1, LauncherVersion: deltaTestVersion, Flavor: "offline"}
	for name, payload := range files {
		manifest.Files = append(manifest.Files, releaseFile{Path: name, Bytes: int64(len(payload)), SHA256: fmt.Sprintf("%x", sha256.Sum256(payload))})
	}
	return manifest
}

// deltaFixture installs the old release and writes a delta that changes
// resources/app.js, adds resources/new.js, drops resources/old.js and carries
// the packaged config file.
func deltaFixture(t *testing.T) (installDir, zipPath string, next map[string][]byte) {
	t.Helper()
	installDir = filepath.Join(t.TempDir(), "portable")
	old := map[string][]byte{
		"icudtl.dat":           []byte("electron runtime"),
		"resources/app.js":     []byte("old app"),
		"resources/old.js":     []byte("removed later"),
		"resources/same.dat":   []byte("unchanged runtime"),
		"config/eduwork.jsonc": []byte("{}"),
	}
	for name, payload := range old {
		writeFixtureFile(t, filepath.Join(installDir, filepath.FromSlash(name)), payload)
	}
	// The user edited the installed configuration; a delta must not reuse it.
	writeFixtureFile(t, filepath.Join(installDir, "config", "eduwork.jsonc"), []byte(`{"user":true}`))
	next = map[string][]byte{
		"icudtl.dat":           old["icudtl.dat"],
		"resources/app.js":     []byte("new app"),
		"resources/new.js":     []byte("added"),
		"resources/same.dat":   old["resources/same.dat"],
		"config/eduwork.jsonc": []byte("{}"),
	}
	carried := map[string][]byte{
		"resources/app.js":     next["resources/app.js"],
		"resources/new.js":     next["resources/new.js"],
		"config/eduwork.jsonc": next["config/eduwork.jsonc"],
	}
	return installDir, writeReleaseZIP(t, deltaManifest(next), carried), next
}

func TestStageDeltaReleaseReusesInstalledFilesAndMatchesFullPackage(t *testing.T) {
	installDir, zipPath, next := deltaFixture(t)
	target := t.TempDir()
	pending := PendingUpdate{Version: deltaTestVersion, Flavor: "offline", DeltaFrom: "0.4.3"}
	root, manifest, err := stageDeltaRelease(zipPath, installDir, target, pending, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Files) != len(next) {
		t.Fatalf("manifest = %#v", manifest)
	}
	for name, payload := range next {
		assertFileValue(t, filepath.Join(root, filepath.FromSlash(name)), string(payload))
	}
	if _, err := os.Stat(filepath.Join(root, "resources", "old.js")); !os.IsNotExist(err) {
		t.Fatalf("removed file was staged: %v", err)
	}
	staged, err := os.Stat(filepath.Join(root, "resources", "same.dat"))
	if err != nil {
		t.Fatal(err)
	}
	installed, err := os.Stat(filepath.Join(installDir, "resources", "same.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(staged, installed) {
		t.Fatal("unchanged file was copied instead of hard-linked")
	}
	staged, err = os.Stat(filepath.Join(root, "icudtl.dat"))
	if err != nil {
		t.Fatal(err)
	}
	installed, err = os.Stat(filepath.Join(installDir, "icudtl.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(staged, installed) {
		t.Fatal("an Electron runtime file was hard-linked; the sandbox ACL step refuses links")
	}
}

func TestStageDeltaReleaseRejectsModifiedInstalledFile(t *testing.T) {
	installDir, zipPath, _ := deltaFixture(t)
	writeFixtureFile(t, filepath.Join(installDir, "resources", "same.dat"), []byte("locally patched"))
	pending := PendingUpdate{Version: deltaTestVersion, Flavor: "offline", DeltaFrom: "0.4.3"}
	if _, _, err := stageDeltaRelease(zipPath, installDir, t.TempDir(), pending, nil); err == nil || !strings.Contains(err.Error(), "resources/same.dat") {
		t.Fatalf("stage error = %v", err)
	}
	assertFileValue(t, filepath.Join(installDir, "resources", "same.dat"), "locally patched")
}

func TestStageDeltaReleaseNeverReusesUserManagedFiles(t *testing.T) {
	installDir := filepath.Join(t.TempDir(), "portable")
	writeFixtureFile(t, filepath.Join(installDir, "config", "eduwork.jsonc"), []byte("{}"))
	next := map[string][]byte{"config/eduwork.jsonc": []byte("{}")}
	zipPath := writeReleaseZIP(t, deltaManifest(next), map[string][]byte{})
	pending := PendingUpdate{Version: deltaTestVersion, Flavor: "offline", DeltaFrom: "0.4.3"}
	if _, _, err := stageDeltaRelease(zipPath, installDir, t.TempDir(), pending, nil); err == nil || !strings.Contains(err.Error(), "cannot reuse") {
		t.Fatalf("stage error = %v", err)
	}
}

func TestDownloadPrefersMatchingDeltaAndFallsBackToFullPackage(t *testing.T) {
	full := []byte("complete release zip")
	digest := func(payload []byte) string { return fmt.Sprintf("%x", sha256.Sum256(payload)) }
	var delta []byte
	deltaAvailable := true
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/releases/stable/0.4.4/full.zip":
			_, _ = w.Write(full)
		case "/releases/stable/0.4.4/full.zip.sha256":
			_, _ = fmt.Fprintf(w, "%s  full.zip\n", digest(full))
		case "/releases/stable/0.4.4/delta.zip":
			if deltaAvailable {
				_, _ = w.Write(delta)
			} else {
				http.NotFound(w, r)
			}
		case "/releases/stable/0.4.4/delta.zip.sha256":
			_, _ = fmt.Fprintf(w, "%s  delta.zip\n", digest(delta))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	base := server.URL + "/releases"
	installed := []byte(`{"schemaVersion":1,"launcherVersion":"0.4.3"}`)
	// states records each reported state; verifying entries carry checked/total
	// and whether a pending update already existed at that moment.
	var states []string
	download := func(t *testing.T, fromManifest string, change func(installDir string)) (PendingUpdate, string) {
		t.Helper()
		installDir, deltaZIP, _ := deltaFixture(t)
		writeFixtureFile(t, filepath.Join(installDir, "RELEASE-MANIFEST.json"), installed)
		if change != nil {
			change(installDir)
		}
		var err error
		if delta, err = os.ReadFile(deltaZIP); err != nil {
			t.Fatal(err)
		}
		stateDir, url := t.TempDir(), base+"/stable/0.4.4/"
		config := DownloadConfig{
			ManifestBaseURL: base, Channel: "stable", Version: deltaTestVersion, CurrentVersion: "0.4.3",
			StateDir: stateDir, InstallDir: installDir, ExecutableName: "EduWork-Electron.exe", HTTPClient: server.Client(),
			Artifact: Artifact{Flavor: "offline", FileName: "full.zip", Bytes: int64(len(full)), SHA256: digest(full), URL: url + "full.zip", SHA256URL: url + "full.zip.sha256",
				Deltas: []DeltaArtifact{{FromVersion: "0.4.3", FromManifestSHA256: fromManifest, FileName: "delta.zip", Bytes: int64(len(delta)), SHA256: digest(delta), URL: url + "delta.zip", SHA256URL: url + "delta.zip.sha256"}}},
		}
		states = nil
		config.Progress = func(status DownloadStatus) {
			state := status.State
			if state == "verifying" {
				_, err := os.Stat(PendingFile(stateDir))
				state = fmt.Sprintf("verifying %d/%d pending=%t", status.CheckedFiles, status.TotalFiles, err == nil)
			}
			if len(states) == 0 || states[len(states)-1] != state {
				states = append(states, state)
			}
		}
		if _, err := Download(context.Background(), config); err != nil {
			t.Fatal(err)
		}
		pending, err := LoadPending(stateDir)
		if err != nil {
			t.Fatal(err)
		}
		return pending, stateDir
	}
	if pending, _ := download(t, digest(installed), nil); pending.DeltaFrom != "0.4.3" || pending.SHA256 != digest(delta) || filepath.Base(pending.ZIPPath) != "delta.zip" {
		t.Fatalf("matching installation did not use the delta: %#v", pending)
	}
	// The two reused files are checked before the delta is ready.
	if got := strings.Join(states, ", "); got != "downloading, verifying 0/2 pending=false, verifying 1/2 pending=false, verifying 2/2 pending=false, ready" {
		t.Fatalf("delta states: %s", got)
	}
	if pending, _ := download(t, strings.Repeat("0", 64), nil); pending.DeltaFrom != "" || pending.SHA256 != digest(full) {
		t.Fatalf("another build used the delta: %#v", pending)
	}
	// A locally modified program file fails the preflight while the old
	// version still runs; the full package replaces the discarded delta.
	pending, stateDir := download(t, digest(installed), func(installDir string) {
		writeFixtureFile(t, filepath.Join(installDir, "resources", "same.dat"), []byte("locally patched"))
	})
	if pending.DeltaFrom != "" || pending.SHA256 != digest(full) {
		t.Fatalf("modified installation kept the delta: %#v", pending)
	}
	// Files are checked in manifest order, so the changed one may come first or second.
	if got := strings.Join(states, ", "); !regexp.MustCompile(`^downloading, verifying 0/2 pending=false, (verifying 1/2 pending=false, )?downloading, ready$`).MatchString(got) {
		t.Fatalf("rejected delta states: %s", got)
	}
	if _, err := os.Stat(rejectedDeltaFile(stateDir, deltaTestVersion)); err != nil {
		t.Fatalf("rejected delta was not recorded: %v", err)
	}
	if _, err := os.Stat(filepath.Join(downloadDir(stateDir, deltaTestVersion), "delta.zip")); !os.IsNotExist(err) {
		t.Fatalf("rejected delta was kept: %v", err)
	}
	deltaAvailable = false
	if pending, _ := download(t, digest(installed), nil); pending.DeltaFrom != "" || pending.SHA256 != digest(full) {
		t.Fatalf("missing delta did not fall back to the full package: %#v", pending)
	}
}

func TestDownloadSkipsDeltaAfterStagingFailure(t *testing.T) {
	stateDir, installDir := t.TempDir(), t.TempDir()
	installed := []byte(`{}`)
	writeFixtureFile(t, filepath.Join(installDir, "RELEASE-MANIFEST.json"), installed)
	config := DownloadConfig{Version: deltaTestVersion, CurrentVersion: "0.4.3", StateDir: stateDir, InstallDir: installDir,
		Artifact: Artifact{Deltas: []DeltaArtifact{{FromVersion: "0.4.3", FromManifestSHA256: fmt.Sprintf("%x", sha256.Sum256(installed))}}}}
	if _, ok := usableDelta(config); !ok {
		t.Fatal("matching delta was not selected")
	}
	deltaZIP := filepath.Join(downloadDir(stateDir, deltaTestVersion), "delta.zip")
	writeFixtureFile(t, deltaZIP, []byte("delta"))
	_ = recordApplyFailure(stateDir, PendingUpdate{Version: deltaTestVersion, DeltaFrom: "0.4.3", ZIPPath: deltaZIP}, fmt.Errorf("release payload hash mismatch"))
	if _, ok := usableDelta(config); ok {
		t.Fatal("rejected delta was selected again")
	}
	if _, err := os.Stat(deltaZIP); !os.IsNotExist(err) {
		t.Fatalf("rejected delta was kept: %v", err)
	}
}

func TestCheckKeepsOnlyTrustedDeltas(t *testing.T) {
	digest := strings.Repeat("a", 64)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		base := "https://" + r.Host + "/releases/stable/0.4.4/"
		deltas := []DeltaArtifact{
			{FromVersion: "0.4.3", FromManifestSHA256: digest, FileName: "from-0.4.3.zip", Bytes: 9, SHA256: digest, URL: base + "from-0.4.3.zip", SHA256URL: base + "from-0.4.3.zip.sha256"},
			{FromVersion: "0.4.2", FromManifestSHA256: digest, FileName: "from-0.4.2.zip", Bytes: 9, SHA256: digest, URL: "https://elsewhere.example/from-0.4.2.zip", SHA256URL: "https://elsewhere.example/from-0.4.2.zip.sha256"},
		}
		payload, _ := json.Marshal(Manifest{SchemaVersion: 1, Channel: "stable", Version: "0.4.4", Target: "windows-amd64", Artifacts: []Artifact{
			{Flavor: "offline", FileName: "full.zip", Bytes: 12, SHA256: digest, URL: base + "full.zip", Deltas: deltas},
		}})
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	status, err := Check(context.Background(), Config{
		ManifestBaseURL: server.URL + "/releases", Channel: "stable", CurrentVersion: "0.4.3",
		Target: "windows-amd64", Flavor: "offline", HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Artifact.Deltas) != 1 || status.Artifact.Deltas[0].FromVersion != "0.4.3" {
		t.Fatalf("trusted deltas = %#v", status.Artifact.Deltas)
	}
}

func TestGitHubCheckKeepsOnlyUploadedDeltas(t *testing.T) {
	config, manifest, release, _ := githubFixture(t, []byte("release data"))
	repo, version, full := "ECNU/EduWork", "0.3.7", manifest.Artifacts[0]
	delta := func(from string) DeltaArtifact {
		name := "EduWork-0.3.7-windows-x64-electron-from-" + from + ".zip"
		return DeltaArtifact{FromVersion: from, FromManifestSHA256: strings.Repeat("b", 64), FileName: name, Bytes: 9, SHA256: strings.Repeat("a", 64),
			URL: githubAssetURL(repo, version, name), SHA256URL: githubAssetURL(repo, version, name) + ".sha256"}
	}
	uploaded, missing, changed := delta("0.3.6"), delta("0.3.5"), delta("0.3.4")
	manifest.Artifacts[0].Deltas = []DeltaArtifact{uploaded, missing, changed}
	body, _ := json.MarshalIndent(manifest, "", "  ")
	body = append(body, '\n')
	release.Assets = []githubAsset{
		{Name: githubManifestName, URL: githubAssetURL(repo, version, githubManifestName), Size: int64(len(body)), Digest: fmt.Sprintf("sha256:%x", sha256.Sum256(body)), State: "uploaded"},
		{Name: full.FileName, URL: full.URL, Size: full.Bytes, Digest: "sha256:" + full.SHA256, State: "uploaded"},
		{Name: full.FileName + ".sha256", URL: full.SHA256URL, Size: 100, State: "uploaded"},
		{Name: uploaded.FileName, URL: uploaded.URL, Size: 9, Digest: "sha256:" + uploaded.SHA256, State: "uploaded"},
		{Name: uploaded.FileName + ".sha256", URL: uploaded.SHA256URL, Size: 100, State: "uploaded"},
		{Name: changed.FileName, URL: changed.URL, Size: 9, Digest: "sha256:" + strings.Repeat("c", 64), State: "uploaded"},
		{Name: changed.FileName + ".sha256", URL: changed.SHA256URL, Size: 100, State: "uploaded"},
	}
	status, err := CheckBest(context.Background(), config, []string{"stable"})
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "available" || len(status.Artifact.Deltas) != 1 || status.Artifact.Deltas[0].FromVersion != "0.3.6" {
		t.Fatalf("GitHub deltas = %#v", status.Artifact.Deltas)
	}
}

func TestSweepCommittedTransactionsKeepsRecoveryBackups(t *testing.T) {
	stateDir := t.TempDir()
	root := filepath.Join(stateDir, "updates", "transactions")
	writeFixtureFile(t, filepath.Join(root, "0.4.3", "backup", "resources", "node.exe"), []byte("still loaded at commit"))
	writeFixtureFile(t, filepath.Join(root, "0.4.3", committedMarker), nil)
	writeFixtureFile(t, filepath.Join(root, "0.4.2", "backup", "EduWork-Electron.exe"), []byte("only intact old program"))
	sweepCommittedTransactions(stateDir)
	if _, err := os.Stat(filepath.Join(root, "0.4.3")); !os.IsNotExist(err) {
		t.Fatalf("committed transaction was kept: %v", err)
	}
	assertFileValue(t, filepath.Join(root, "0.4.2", "backup", "EduWork-Electron.exe"), "only intact old program")
}

func TestApplyPendingDeltaReplacesManagedTreeAndConfirmsHealth(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the portable release updater is currently a Windows delivery path")
	}
	fixture := newApplyFixture(t, "0.2.0-dev.20260815.11", "healthy")
	pending, err := LoadPending(fixture.stateDir)
	if err != nil {
		t.Fatal(err)
	}
	// Turn the fixture's full package into a delta: the executable is unchanged
	// and must come from the installation.
	executable, err := os.ReadFile(filepath.Join(fixture.installDir, pending.ExecutableName))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{
		pending.ExecutableName:  executable,
		"resources/version.txt": []byte("new-version"),
		"data/offline/new.txt":  []byte("new-offline-asset"),
	}
	manifest := deltaManifest(files)
	manifest.LauncherVersion = pending.Version
	archive := writeReleaseZIP(t, manifest, map[string][]byte{"resources/version.txt": files["resources/version.txt"], "data/offline/new.txt": files["data/offline/new.txt"]})
	payload, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	writeFixtureFile(t, pending.ZIPPath, payload)
	pending.SHA256 = fmt.Sprintf("%x", sha256.Sum256(payload))
	pending.DeltaFrom = "0.2.0-dev.20260815.10"
	if err := SavePending(fixture.stateDir, pending); err != nil {
		t.Fatal(err)
	}
	if err := ApplyPending(PendingFile(fixture.stateDir), 0); err != nil {
		t.Fatal(err)
	}
	assertFileValue(t, filepath.Join(fixture.installDir, "resources", "version.txt"), "new-version")
	assertFileValue(t, filepath.Join(fixture.installDir, "data", "user", "keep.txt"), "user-data")
	assertFileValue(t, filepath.Join(fixture.installDir, "data", "offline", "new.txt"), "new-offline-asset")
}
