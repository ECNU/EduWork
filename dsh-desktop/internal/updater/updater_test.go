package updater

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

var updaterTestHealthFile = flag.String("update-health-file", "", "internal updater test health file")
var updaterTestMode = flag.String("update-test-mode", "healthy", "internal updater test mode")

func TestUpdaterHealthChild(t *testing.T) {
	if strings.TrimSpace(*updaterTestHealthFile) == "" {
		return
	}
	if *updaterTestMode == "fail" {
		os.Exit(23)
	}
	if err := os.MkdirAll(filepath.Dir(*updaterTestHealthFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(*updaterTestHealthFile, []byte("ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		left, right string
		want        int
	}{
		{"0.12.0", "0.11.9", 1},
		{"1.0.0", "1.0.0-dev", 1},
		{"1.0.0-dev.2", "1.0.0-dev.10", -1},
		{"1.2.3+build.2", "1.2.3+build.1", 0},
		{"0.3.0", "0.2.0-dev.20260909.3", 1},
		{"0.3.0", "0.3.0-rc.4", 1},
		{"0.3.0", "0.3.0-dev.20260910.4", 1},
		{"0.3.1", "0.3.1-dev.20260912.10", 1},
	}
	for _, test := range tests {
		got, err := CompareVersions(test.left, test.right)
		if err != nil {
			t.Fatal(err)
		}
		if got != test.want {
			t.Fatalf("CompareVersions(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func TestCompareVersionsRejectsInvalidSemVer(t *testing.T) {
	for _, version := range []string{"01.2.3", "1.02.3", "1.2.03", "1.2.3-dev..1", "1.2.3-dev.01"} {
		if _, err := CompareVersions(version, "1.0.0"); err == nil {
			t.Fatalf("CompareVersions(%q, ...) accepted invalid SemVer", version)
		}
	}
}

func TestDownloadRequiresOnlineSidecarAndPersistsPending(t *testing.T) {
	payload := []byte("verified release zip bytes")
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/releases/development/0.13.0-dev.20260809.1/agent.zip.sha256":
			_, _ = fmt.Fprintf(w, "%s  agent.zip\n", digest)
		case "/releases/development/0.13.0-dev.20260809.1/agent.zip":
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	stateDir := t.TempDir()
	base := server.URL + "/releases"
	artifactURL := base + "/development/0.13.0-dev.20260809.1/agent.zip"
	result, err := Download(context.Background(), DownloadConfig{
		ManifestBaseURL: base, Channel: "development", Version: "0.13.0-dev.20260809.1",
		StateDir: stateDir, InstallDir: t.TempDir(), ExecutableName: "ecnu-agent.exe", HTTPClient: server.Client(),
		Artifact: Artifact{Flavor: "online", FileName: "agent.zip", Bytes: int64(len(payload)), SHA256: digest, URL: artifactURL, SHA256URL: artifactURL + ".sha256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "ready" || result.DownloadedBytes != int64(len(payload)) {
		t.Fatalf("download result = %#v", result)
	}
	pending, err := LoadPending(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Version != "0.13.0-dev.20260809.1" || pending.SHA256 != digest || pending.State != "ready" {
		t.Fatalf("pending = %#v", pending)
	}
}

func TestDownloadKeepsInterruptedPartAndResumesOnRetry(t *testing.T) {
	payload := bytes.Repeat([]byte("resumable-update-payload-"), 32)
	prefixLength := int64(len(payload) / 3)
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	version := "0.13.0-dev.20260817.4"
	fileName := "agent.zip"
	baseURL := "https://updates.example/releases"
	artifactURL := baseURL + "/development/" + version + "/" + fileName
	artifactRequests := 0
	var resumedRange string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		headers := make(http.Header)
		if strings.HasSuffix(request.URL.Path, ".sha256") {
			body := fmt.Sprintf("%s  %s\n", digest, fileName)
			return testHTTPResponse(http.StatusOK, body, headers), nil
		}
		artifactRequests++
		if artifactRequests == 1 {
			body := io.NopCloser(io.MultiReader(bytes.NewReader(payload[:prefixLength]), errorReader{errors.New("connection interrupted")}))
			return &http.Response{StatusCode: http.StatusOK, Body: body, Header: headers, ContentLength: int64(len(payload))}, nil
		}
		resumedRange = request.Header.Get("Range")
		headers.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", prefixLength, len(payload)-1, len(payload)))
		return &http.Response{
			StatusCode: http.StatusPartialContent, Body: io.NopCloser(bytes.NewReader(payload[prefixLength:])),
			Header: headers, ContentLength: int64(len(payload)) - prefixLength,
		}, nil
	})}
	stateDir := t.TempDir()
	config := downloadTestConfig(t, stateDir, baseURL, artifactURL, version, fileName, payload, digest, client)
	if _, err := Download(context.Background(), config); err == nil {
		t.Fatal("interrupted download unexpectedly succeeded")
	}
	partPath := filepath.Join(stateDir, "updates", "downloads", version, fileName+".part")
	info, err := os.Stat(partPath)
	if err != nil {
		t.Fatalf("partial download was not retained: %v", err)
	}
	if info.Size() != prefixLength {
		t.Fatalf("partial size = %d, want %d", info.Size(), prefixLength)
	}
	result, err := Download(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	if resumedRange != fmt.Sprintf("bytes=%d-", prefixLength) {
		t.Fatalf("Range = %q", resumedRange)
	}
	if result.State != "ready" || result.DownloadedBytes != int64(len(payload)) {
		t.Fatalf("download result = %#v", result)
	}
}

func TestDownloadRestartsWhenServerIgnoresRange(t *testing.T) {
	payload := bytes.Repeat([]byte("full-response-fallback-"), 24)
	prefixLength := int64(len(payload) / 4)
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	version := "0.13.0-dev.20260817.5"
	fileName := "agent.zip"
	baseURL := "https://updates.example/releases"
	artifactURL := baseURL + "/development/" + version + "/" + fileName
	var requestedRange string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		headers := make(http.Header)
		if strings.HasSuffix(request.URL.Path, ".sha256") {
			return testHTTPResponse(http.StatusOK, fmt.Sprintf("%s  %s\n", digest, fileName), headers), nil
		}
		requestedRange = request.Header.Get("Range")
		return testHTTPResponse(http.StatusOK, string(payload), headers), nil
	})}
	stateDir := t.TempDir()
	partPath := filepath.Join(stateDir, "updates", "downloads", version, fileName+".part")
	if err := os.MkdirAll(filepath.Dir(partPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partPath, payload[:prefixLength], 0o600); err != nil {
		t.Fatal(err)
	}
	config := downloadTestConfig(t, stateDir, baseURL, artifactURL, version, fileName, payload, digest, client)
	if _, err := Download(context.Background(), config); err != nil {
		t.Fatal(err)
	}
	if requestedRange != fmt.Sprintf("bytes=%d-", prefixLength) {
		t.Fatalf("Range = %q", requestedRange)
	}
	completed, err := os.ReadFile(filepath.Join(filepath.Dir(partPath), fileName))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(completed, payload) {
		t.Fatal("full response was appended to the old partial file")
	}
}

func TestDownloadRepairsDamagedPartialAfterHashMismatch(t *testing.T) {
	payload := bytes.Repeat([]byte("verified-after-restart-"), 24)
	prefixLength := int64(len(payload) / 3)
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	version := "0.13.0-dev.20260817.6"
	fileName := "agent.zip"
	baseURL := "https://updates.example/releases"
	artifactURL := baseURL + "/development/" + version + "/" + fileName
	rangeRequests := 0
	fullRequests := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		headers := make(http.Header)
		if strings.HasSuffix(request.URL.Path, ".sha256") {
			return testHTTPResponse(http.StatusOK, fmt.Sprintf("%s  %s\n", digest, fileName), headers), nil
		}
		if request.Header.Get("Range") != "" {
			rangeRequests++
			headers.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", prefixLength, len(payload)-1, len(payload)))
			return &http.Response{
				StatusCode: http.StatusPartialContent, Body: io.NopCloser(bytes.NewReader(payload[prefixLength:])),
				Header: headers, ContentLength: int64(len(payload)) - prefixLength,
			}, nil
		}
		fullRequests++
		return testHTTPResponse(http.StatusOK, string(payload), headers), nil
	})}
	stateDir := t.TempDir()
	partPath := filepath.Join(stateDir, "updates", "downloads", version, fileName+".part")
	if err := os.MkdirAll(filepath.Dir(partPath), 0o700); err != nil {
		t.Fatal(err)
	}
	damagedPrefix := bytes.Repeat([]byte{'x'}, int(prefixLength))
	if err := os.WriteFile(partPath, damagedPrefix, 0o600); err != nil {
		t.Fatal(err)
	}
	config := downloadTestConfig(t, stateDir, baseURL, artifactURL, version, fileName, payload, digest, client)
	if _, err := Download(context.Background(), config); err != nil {
		t.Fatal(err)
	}
	if rangeRequests != 1 || fullRequests != 1 {
		t.Fatalf("range requests = %d, full requests = %d", rangeRequests, fullRequests)
	}
}

func downloadTestConfig(t *testing.T, stateDir, baseURL, artifactURL, version, fileName string, payload []byte, digest string, client *http.Client) DownloadConfig {
	t.Helper()
	return DownloadConfig{
		ManifestBaseURL: baseURL, Channel: "development", Version: version,
		StateDir: stateDir, InstallDir: t.TempDir(), ExecutableName: "agent.exe", HTTPClient: client,
		Artifact: Artifact{
			Flavor: "offline", FileName: fileName, Bytes: int64(len(payload)), SHA256: digest,
			URL: artifactURL, SHA256URL: artifactURL + ".sha256",
		},
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type errorReader struct {
	err error
}

func (reader errorReader) Read([]byte) (int, error) {
	return 0, reader.err
}

func testHTTPResponse(status int, body string, headers http.Header) *http.Response {
	return &http.Response{
		StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: headers, ContentLength: int64(len(body)),
	}
}

func TestCheckSelectsTrustedFlavor(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/releases/development/latest-windows-amd64.json" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		base := "https://" + r.Host + "/releases/development/0.12.0/"
		_, _ = w.Write([]byte(`{"schemaVersion":1,"channel":"development","version":"0.12.0","target":"windows-amd64","publishedAt":"2026-08-09T00:00:00Z","artifacts":[{"flavor":"online","fileName":"agent.zip","bytes":12,"sha256":"` + strings.Repeat("a", 64) + `","objectKey":"development/0.12.0/agent.zip","url":"` + base + `agent.zip"}]}`))
	}))
	defer server.Close()
	status, err := Check(context.Background(), Config{
		ManifestBaseURL: server.URL + "/releases", Channel: "development", CurrentVersion: "0.11.0-dev",
		Target: "windows-amd64", Flavor: "online", HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "available" || status.LatestVersion != "0.12.0" || status.Artifact.FileName != "agent.zip" {
		t.Fatalf("status = %#v", status)
	}
}

func TestCheckRejectsArtifactOutsideTrustedPrefix(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"schemaVersion":1,"channel":"stable","version":"1.0.0","target":"windows-amd64","artifacts":[{"flavor":"online","fileName":"agent.zip","bytes":12,"sha256":"` + strings.Repeat("b", 64) + `","url":"https://evil.example/agent.zip"}]}`))
	}))
	defer server.Close()
	_, err := Check(context.Background(), Config{ManifestBaseURL: server.URL + "/releases", Channel: "stable", CurrentVersion: "0.9.0", Target: "windows-amd64", Flavor: "online", HTTPClient: server.Client()})
	if err == nil {
		t.Fatal("expected untrusted URL error")
	}
}

func TestCheckBestUsesSemVerAcrossStableAndDevelopment(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		channel := "stable"
		version := "0.12.0"
		if strings.Contains(r.URL.Path, "/development/") {
			channel = "development"
			version = "0.13.0-dev.20260809.2"
		}
		base := "https://" + r.Host + "/releases/" + channel + "/" + version + "/"
		_, _ = w.Write([]byte(`{"schemaVersion":1,"channel":"` + channel + `","version":"` + version + `","target":"windows-amd64","artifacts":[{"flavor":"online","fileName":"agent.zip","bytes":12,"sha256":"` + strings.Repeat("c", 64) + `","url":"` + base + `agent.zip"}]}`))
	}))
	defer server.Close()
	status, err := CheckBest(context.Background(), Config{
		ManifestBaseURL: server.URL + "/releases", CurrentVersion: "0.12.0", Target: "windows-amd64", Flavor: "online", HTTPClient: server.Client(),
	}, []string{"stable", "development"})
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "available" || status.Channel != "development" || status.LatestVersion != "0.13.0-dev.20260809.2" {
		t.Fatalf("status = %#v", status)
	}
}

func TestDevelopmentBridgeToPublicElectronVersionRouting(t *testing.T) {
	stable, development := "0.3.5", "0.3.5-dev.20260912.1"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		channel, version := "stable", stable
		if strings.Contains(r.URL.Path, "/development/") {
			channel, version = "development", development
		}
		base := "https://" + r.Host + "/releases/" + channel + "/" + version + "/"
		fmt.Fprintf(w, `{"schemaVersion":1,"channel":%q,"version":%q,"target":"windows-amd64","artifacts":[{"flavor":"offline","fileName":"electron.zip","bytes":12,"sha256":%q,"url":%q}]}`, channel, version, strings.Repeat("c", 64), base+"electron.zip")
	}))
	defer server.Close()
	config := Config{ManifestBaseURL: server.URL + "/releases", CurrentVersion: development, Target: "windows-amd64", Flavor: "offline", HTTPClient: server.Client()}
	status, err := CheckBest(t.Context(), config, []string{"stable", "development"})
	if err != nil || status.LatestVersion != "0.3.5" || status.State != "available" {
		t.Fatalf("public promotion: %#v, %v", status, err)
	}
	stable = "0.3.4" // Switching to public never installs an older public version over newer dev.
	status, err = CheckBest(t.Context(), config, []string{"stable"})
	if err != nil || status.State == "available" {
		t.Fatalf("downgrade: %#v, %v", status, err)
	}
	stable = "0.3.6-dev.20260913.1" // A publication mistake must not contaminate the public channel.
	_, err = CheckBest(t.Context(), config, []string{"stable"})
	if err == nil || !strings.Contains(err.Error(), "公测更新渠道不能提供开发版本") {
		t.Fatalf("accepted dev on public: %v", err)
	}
}

func TestExtractAndVerifyReleaseRejectsUndeclaredFiles(t *testing.T) {
	payload := []byte("new launcher")
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	manifest := releaseManifest{
		SchemaVersion: 1, LauncherVersion: "0.13.0-dev.20260809.1", Flavor: "online",
		Files: []releaseFile{{Path: "ecnu-agent.exe", Bytes: int64(len(payload)), SHA256: digest}},
	}
	pending := PendingUpdate{Version: manifest.LauncherVersion, Flavor: manifest.Flavor}

	validZIP := writeReleaseZIP(t, manifest, map[string][]byte{"ecnu-agent.exe": payload})
	root, decoded, err := extractAndVerifyRelease(validZIP, filepath.Join(t.TempDir(), "valid"), pending)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.LauncherVersion != pending.Version {
		t.Fatalf("manifest = %#v", decoded)
	}
	if data, err := os.ReadFile(filepath.Join(root, "ecnu-agent.exe")); err != nil || string(data) != string(payload) {
		t.Fatalf("installed payload = %q, %v", data, err)
	}

	forgedZIP := writeReleaseZIP(t, manifest, map[string][]byte{
		"ecnu-agent.exe": payload,
		"unexpected.dll": []byte("not declared"),
	})
	if _, _, err := extractAndVerifyRelease(forgedZIP, filepath.Join(t.TempDir(), "forged"), pending); err == nil || !strings.Contains(err.Error(), "undeclared") {
		t.Fatalf("forged release error = %v", err)
	}
}

func TestDecodeReleaseManifestAcceptsPortableOfflineSizeAndKeepsBound(t *testing.T) {
	prefix := []byte(`{"schemaVersion":1,"launcherVersion":"0.2.0-dev.20260815.9","flavor":"offline","files":[]}`)
	portableSized := append(prefix, bytes.Repeat([]byte(" "), (9<<20)-len(prefix))...)
	manifest, err := decodeReleaseManifest(portableSized)
	if err != nil {
		t.Fatalf("portable offline manifest was rejected: %v", err)
	}
	if manifest.LauncherVersion != "0.2.0-dev.20260815.9" || manifest.Flavor != "offline" {
		t.Fatalf("manifest = %#v", manifest)
	}

	tooLarge := bytes.Repeat([]byte(" "), maxReleaseManifestBytes+1)
	if _, err := decodeReleaseManifest(tooLarge); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("oversized release manifest error = %v", err)
	}
}

func TestCollectManagedRootsNeverReplacesPrivateData(t *testing.T) {
	manifest := releaseManifest{SchemaVersion: 1, Files: []releaseFile{
		{Path: "ecnu-agent.exe"},
		{Path: "resources/theme.json"},
		{Path: "data/config/opencode.json"},
		{Path: "Config/eduwork.jsonc"},
		{Path: "DATA/sessions/keep.json"},
		{Path: ".env"},
	}}
	got, err := collectManagedRoots(t.TempDir(), manifest)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(got, ",")
	if joined != "RELEASE-MANIFEST.json,ecnu-agent.exe,resources" {
		t.Fatalf("managed roots = %q", joined)
	}
}

func TestPreviousManifestCannotClaimParentAsManagedRoot(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, filepath.Join(root, "RELEASE-MANIFEST.json"), []byte(`{"schemaVersion":1,"files":[{"path":"../outside/file"}]}`))
	if _, err := collectManagedRoots(root, releaseManifest{}); err == nil {
		t.Fatal("accepted an invalid previous manifest")
	}
}

func TestMergeReleaseDataRestoresMissingOfflineComponentsWithoutOverwritingUserData(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	write := func(root, name, value string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write(source, "js/e/remotion/node_modules/remotion/package.json", "packaged-remotion")
	write(source, "config/opencode/auth.json", "release-placeholder")
	write(target, "config/opencode/auth.json", "user-secret")

	if err := mergeReleaseData(source, target); err != nil {
		t.Fatal(err)
	}
	component, err := os.ReadFile(filepath.Join(target, "js", "e", "remotion", "node_modules", "remotion", "package.json"))
	if err != nil || string(component) != "packaged-remotion" {
		t.Fatalf("offline component = %q, %v", component, err)
	}
	credential, err := os.ReadFile(filepath.Join(target, "config", "opencode", "auth.json"))
	if err != nil || string(credential) != "user-secret" {
		t.Fatalf("user data was overwritten: %q, %v", credential, err)
	}
}

func TestMergeReleaseDataAddsNewOfflineEnvironmentBesidePreviousIdentity(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	write := func(root, name, value string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write(target, "js/e/old-environment/.ecnu-agent-node-env.json", "old-attestation")
	write(source, "js/e/new-browser-environment/.ecnu-agent-node-env.json", "new-attestation")
	write(source, "js/e/new-browser-environment/playwright-browsers/chromium-1237/chrome.exe", "pinned-browser")

	if err := mergeReleaseData(source, target); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{
		"js/e/old-environment/.ecnu-agent-node-env.json":                            "old-attestation",
		"js/e/new-browser-environment/.ecnu-agent-node-env.json":                    "new-attestation",
		"js/e/new-browser-environment/playwright-browsers/chromium-1237/chrome.exe": "pinned-browser",
	} {
		got, err := os.ReadFile(filepath.Join(target, filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Fatalf("merged offline file %s = %q, %v; want %q", name, got, err, want)
		}
	}
}

func TestApplyPendingReplacesManagedTreePreservesDataAndConfirmsHealth(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the portable release updater is currently a Windows delivery path")
	}
	fixture := newApplyFixture(t, "0.2.0-dev.20260815.9", "healthy")
	var progress []ApplyProgress
	if err := ApplyPendingWithProgress(PendingFile(fixture.stateDir), 0, func(update ApplyProgress) {
		progress = append(progress, update)
	}); err != nil {
		t.Fatal(err)
	}
	wantStages := map[string]bool{
		"verify-package": false, "extract": false, "verify-files": false,
		"replace": false, "health": false, "done": false,
	}
	lastPercent := -1
	for _, update := range progress {
		if update.Percent < lastPercent {
			t.Fatalf("update progress moved backwards: %#v", progress)
		}
		lastPercent = update.Percent
		if _, ok := wantStages[update.Stage]; ok {
			wantStages[update.Stage] = true
		}
	}
	for stage, seen := range wantStages {
		if !seen {
			t.Errorf("update progress did not report %q: %#v", stage, progress)
		}
	}
	assertFileValue(t, filepath.Join(fixture.installDir, "resources", "version.txt"), "new-version")
	assertFileValue(t, filepath.Join(fixture.installDir, "data", "user", "keep.txt"), "user-data")
	assertFileValue(t, filepath.Join(fixture.installDir, "data", "offline", "new.txt"), "new-offline-asset")
	if _, err := os.Stat(PendingFile(fixture.stateDir)); !os.IsNotExist(err) {
		t.Fatalf("successful update retained pending state: %v", err)
	}
}

func TestApplyPendingRollsBackManagedTreeWhenNewBuildFailsHealth(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the portable release updater is currently a Windows delivery path")
	}
	fixture := newApplyFixture(t, "0.2.0-dev.20260815.10", "fail")
	if err := ApplyPending(PendingFile(fixture.stateDir), 0); err == nil || !strings.Contains(err.Error(), "exited before startup health") {
		t.Fatalf("failed update error = %v", err)
	}
	assertFileValue(t, filepath.Join(fixture.installDir, "resources", "version.txt"), "old-version")
	assertFileValue(t, filepath.Join(fixture.installDir, "data", "user", "keep.txt"), "user-data")
	pending, err := LoadPending(fixture.stateDir)
	if err != nil || pending.State != "error" || pending.Error == "" {
		t.Fatalf("rollback pending state = %#v, %v", pending, err)
	}
}

type applyFixture struct {
	installDir string
	stateDir   string
}

func newApplyFixture(t *testing.T, version, mode string) applyFixture {
	t.Helper()
	testExecutable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executablePayload, err := os.ReadFile(testExecutable)
	if err != nil {
		t.Fatal(err)
	}
	installDir := filepath.Join(t.TempDir(), "portable")
	stateDir := filepath.Join(installDir, "data", "state")
	executableName := "ChatECNU-Work.exe"
	writeFixtureFile(t, filepath.Join(installDir, executableName), executablePayload)
	writeFixtureFile(t, filepath.Join(installDir, "resources", "version.txt"), []byte("old-version"))
	writeFixtureFile(t, filepath.Join(installDir, "data", "user", "keep.txt"), []byte("user-data"))

	files := map[string][]byte{
		executableName:          executablePayload,
		"resources/version.txt": []byte("new-version"),
		"data/offline/new.txt":  []byte("new-offline-asset"),
	}
	manifest := releaseManifest{SchemaVersion: 1, LauncherVersion: version, Flavor: "offline"}
	for name, payload := range files {
		digest := fmt.Sprintf("%x", sha256.Sum256(payload))
		manifest.Files = append(manifest.Files, releaseFile{Path: name, Bytes: int64(len(payload)), SHA256: digest})
	}
	archivePath := writeReleaseZIP(t, manifest, files)
	archivePayload, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	downloadDir := filepath.Join(stateDir, "updates", "downloads", version)
	zipPath := filepath.Join(downloadDir, "release.zip")
	writeFixtureFile(t, zipPath, archivePayload)
	restartArgs := []string{"-test.run=^TestUpdaterHealthChild$"}
	if mode != "healthy" {
		restartArgs = append(restartArgs, "-update-test-mode="+mode)
	}
	pending := PendingUpdate{
		SchemaVersion: pendingSchemaVersion, Version: version, Channel: "development", Flavor: "offline",
		ZIPPath: zipPath, SHA256: fmt.Sprintf("%x", sha256.Sum256(archivePayload)),
		InstallDir: installDir, ExecutableName: executableName, RestartArgs: restartArgs,
		State: "ready", CreatedAt: "2026-08-15T00:00:00Z",
	}
	if err := SavePending(stateDir, pending); err != nil {
		t.Fatal(err)
	}
	return applyFixture{installDir: installDir, stateDir: stateDir}
}

func writeFixtureFile(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o755); err != nil {
		t.Fatal(err)
	}
}

func assertFileValue(t *testing.T, path, want string) {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil || string(payload) != want {
		t.Fatalf("%s = %q, %v; want %q", path, payload, err, want)
	}
}

func writeReleaseZIP(t *testing.T, manifest releaseManifest, files map[string][]byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "release.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	write := func(name string, data []byte) {
		entry, err := archive.Create("ECNU-Agent/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	manifestData, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	write("RELEASE-MANIFEST.json", manifestData)
	for name, data := range files {
		write(name, data)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
