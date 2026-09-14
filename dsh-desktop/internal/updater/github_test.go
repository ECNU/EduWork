package updater

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type githubRoundTrip func(*http.Request) (*http.Response, error)

func (f githubRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func githubFixture(t *testing.T, payload []byte) (Config, *Manifest, *githubRelease, *int) {
	return githubVersionFixture(t, payload, "0.3.7")
}

func githubVersionFixture(t *testing.T, payload []byte, version string) (Config, *Manifest, *githubRelease, *int) {
	t.Helper()
	repo := "ECNU/EduWork"
	name := "EduWork-" + version + "-windows-x64-electron.zip"
	artifact := Artifact{Flavor: "offline", Shell: "electron", FileName: name, Bytes: int64(len(payload)), SHA256: fmt.Sprintf("%x", sha256.Sum256(payload)), URL: githubAssetURL(repo, version, name), SHA256URL: githubAssetURL(repo, version, name) + ".sha256"}
	manifest := &Manifest{SchemaVersion: 1, Distribution: "eduwork", Version: version, Channel: "stable", Target: "windows-amd64", Artifacts: []Artifact{artifact}}
	release := &githubRelease{Tag: "v" + version, PublishedAt: "2026-09-14T00:00:00Z"}
	if strings.Contains(version, "-dev.") {
		manifest.Channel = "development"
		release.Prerelease = true
	}
	calls := 0
	client := &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatal("credentials leaked into public update request")
		}
		body, _ := json.Marshal(manifest)
		headers := http.Header{}
		status := 200
		switch {
		case req.URL.Host == "api.github.com":
			assets := []githubAsset{{Name: githubManifestName, URL: githubAssetURL(repo, version, githubManifestName), Size: int64(len(body)), Digest: fmt.Sprintf("sha256:%x", sha256.Sum256(body)), State: "uploaded"}, {Name: name, URL: artifact.URL, Size: artifact.Bytes, Digest: "sha256:" + artifact.SHA256, State: "uploaded"}, {Name: name + ".sha256", URL: artifact.SHA256URL, Size: 100, State: "uploaded"}}
			if release.Assets != nil {
				assets = release.Assets
			}
			copy := *release
			copy.Assets = assets
			body, _ = json.Marshal(copy)
			if req.URL.Query().Get("per_page") != "" {
				body, _ = json.Marshal([]githubRelease{copy})
			}
		case strings.HasSuffix(req.URL.Path, "/"+githubManifestName):
		case strings.HasSuffix(req.URL.Path, ".sha256"):
			body = []byte(artifact.SHA256 + "  " + name + "\n")
		case strings.HasSuffix(req.URL.Path, ".zip"):
			body = payload
			if offsetHeader := req.Header.Get("Range"); offsetHeader != "" {
				offset, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(offsetHeader, "bytes="), "-"))
				if err != nil {
					t.Fatal(err)
				}
				body = payload[offset:]
				status = 206
				headers.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(payload)-1, len(payload)))
			}
		default:
			t.Fatalf("unexpected URL %s", req.URL)
		}
		return &http.Response{StatusCode: status, Header: headers, Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body)), Request: req}, nil
	})}
	return Config{Provider: "github", GitHubRepository: "ecnu/EduWork", Distribution: "eduwork", Target: "windows-amd64", Flavor: "offline", CurrentVersion: "0.3.6-dev.20260913.1", AllowShellMigration: true, HTTPClient: client}, manifest, release, &calls
}

func TestGitHubDiscoveryDownloadResumeAndCache(t *testing.T) {
	payload := bytes.Repeat([]byte("release data"), 1024)
	config, _, _, calls := githubFixture(t, payload)
	config.CacheDir = t.TempDir()
	status, err := CheckBest(context.Background(), config, []string{"stable"})
	if err != nil || status.State != "available" {
		t.Fatalf("%+v %v", status, err)
	}
	if *calls != 2 {
		t.Fatalf("duplicate channel requests: %d", *calls)
	}
	if _, err = CheckBest(context.Background(), config, []string{"stable"}); err != nil || *calls != 2 {
		t.Fatalf("cache missed: %d %v", *calls, err)
	}
	config.CurrentVersion = "0.3.8"
	if newer, err := CheckBest(context.Background(), config, []string{"stable"}); err != nil || newer.State != "up_to_date" {
		t.Fatal("downgrade offered", newer, err)
	}
	state := t.TempDir()
	partial := filepath.Join(state, "updates/downloads", status.LatestVersion, status.Artifact.FileName+".part")
	writeFixtureFile(t, partial, payload[:100])
	var progress []int64
	result, err := Download(context.Background(), DownloadConfig{Provider: "github", GitHubRepository: config.GitHubRepository, Distribution: config.Distribution, Version: status.LatestVersion, Channel: "stable", StateDir: state, InstallDir: t.TempDir(), ExecutableName: "EduWork-Electron.exe", Artifact: status.Artifact, HTTPClient: config.HTTPClient, AllowShellMigration: true, Progress: func(s DownloadStatus) { progress = append(progress, s.DownloadedBytes) }})
	if err != nil || result.State != "ready" || len(progress) < 2 || progress[0] != 100 {
		t.Fatalf("resume/progress: %+v %v %v", result, progress, err)
	}
	pending, err := LoadPending(state)
	if err != nil || pending.TargetShell != "electron" || pending.SHA256 != status.Artifact.SHA256 {
		t.Fatal(pending, err)
	}
	if err := verifyFileSHA256(pending.ZIPPath, status.Artifact.SHA256); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubRejectsWrongEditionReleaseAndArtifact(t *testing.T) {
	for _, bad := range []string{"draft", "prerelease", "dev-tag", "distribution", "platform", "version", "hash", "host", "repository", "shell", "missing-assets"} {
		t.Run(bad, func(t *testing.T) {
			config, m, r, _ := githubFixture(t, []byte("zip"))
			switch bad {
			case "draft":
				r.Draft = true
			case "prerelease":
				r.Prerelease = true
			case "dev-tag":
				r.Tag = "v0.3.7-dev.20260914.1"
			case "distribution":
				m.Distribution = "eduwork-chatecnu"
			case "platform":
				m.Target = "darwin-arm64"
			case "version":
				m.Version = "0.3.8"
			case "hash":
				m.Artifacts[0].SHA256 = strings.Repeat("a", 64)
			case "host":
				m.Artifacts[0].URL = "https://example.org/malware.zip"
			case "repository":
				config.GitHubRepository = "ecnu/EduWork/../../other"
			case "shell":
				m.Artifacts[0].Shell = "wails"
			case "missing-assets":
				r.Assets = []githubAsset{}
			}
			if _, err := CheckBest(context.Background(), config, []string{"stable"}); err == nil {
				t.Fatal("invalid update accepted")
			}
		})
	}
}

func TestGitHubUnavailableAndRateLimitedResultsAreNotLatest(t *testing.T) {
	for _, code := range []int{404, 403, 429} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			config, _, _, _ := githubFixture(t, []byte("zip"))
			config.CacheDir = t.TempDir()
			calls := 0
			config.HTTPClient = &http.Client{Transport: githubRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
			})}
			for i := 0; i < 2; i++ {
				if _, err := CheckBest(context.Background(), config, []string{"stable"}); err == nil {
					t.Fatal("unavailable feed claimed up to date")
				}
			}
			if calls != 1 {
				t.Fatal("failure backoff not applied", calls)
			}
		})
	}
}

func TestGitHubRedirectBoundaries(t *testing.T) {
	client := githubHTTPClient(nil, "ecnu/EduWork", "0.3.7")
	for _, raw := range []string{"https://release-assets.githubusercontent.com/asset?sig=test", "https://github.com/ECNU/EduWork/releases/download/v0.3.7/a.zip"} {
		u, _ := url.Parse(raw)
		req := &http.Request{URL: u, Header: http.Header{"Authorization": []string{"secret"}, "Cookie": []string{"private"}}}
		if err := client.CheckRedirect(req, nil); err != nil || req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatal(raw, err)
		}
	}
	for _, raw := range []string{"http://release-assets.githubusercontent.com/a", "https://evil.example/a", "https://release-assets.githubusercontent.com.evil.example/a", "https://github.com/other/repo/releases/download/v0.3.7/a.zip", "https://user:pass@github.com/ecnu/EduWork/releases/download/v0.3.7/a.zip", "https://github.com/ecnu/EduWork/releases/download/v0.3.7/../a.zip"} {
		u, _ := url.Parse(raw)
		if client.CheckRedirect(&http.Request{URL: u, Header: http.Header{}}, nil) == nil {
			t.Fatal("unsafe redirect accepted", raw)
		}
	}
}

func TestGitHubDownloadFollowsSignedAssetRedirect(t *testing.T) {
	config, _, _, _ := githubFixture(t, []byte("zip payload"))
	status, err := CheckBest(context.Background(), config, []string{"stable"})
	if err != nil {
		t.Fatal(err)
	}
	original := config.HTTPClient.Transport
	redirected := false
	config.HTTPClient.Transport = githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "github.com" && strings.HasSuffix(req.URL.Path, ".zip") {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://release-assets.githubusercontent.com/example.zip?signature=synthetic"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
		}
		if req.URL.Host == "release-assets.githubusercontent.com" {
			redirected = true
		}
		return original.RoundTrip(req)
	})
	result, err := Download(context.Background(), DownloadConfig{Provider: "github", GitHubRepository: config.GitHubRepository, Distribution: config.Distribution, Version: status.LatestVersion, StateDir: t.TempDir(), InstallDir: t.TempDir(), Artifact: status.Artifact, HTTPClient: config.HTTPClient, AllowShellMigration: true})
	if err != nil || result.State != "ready" || !redirected {
		t.Fatal(result, err, redirected)
	}
}

func TestGitHubCorruptDownloadCannotBecomePending(t *testing.T) {
	config, _, _, _ := githubFixture(t, []byte("valid archive"))
	status, err := CheckBest(context.Background(), config, []string{"stable"})
	if err != nil {
		t.Fatal(err)
	}
	transport := config.HTTPClient.Transport
	config.HTTPClient.Transport = githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		resp, err := transport.RoundTrip(req)
		if strings.HasSuffix(req.URL.Path, ".zip") {
			resp.Body = io.NopCloser(strings.NewReader("wrong archive"))
		}
		return resp, err
	})
	state := t.TempDir()
	_, err = Download(context.Background(), DownloadConfig{Provider: "github", GitHubRepository: config.GitHubRepository, Distribution: config.Distribution, Version: status.LatestVersion, StateDir: state, InstallDir: t.TempDir(), Artifact: status.Artifact, HTTPClient: config.HTTPClient, AllowShellMigration: true})
	if err == nil {
		t.Fatal("corrupt archive accepted")
	}
	if _, err := os.Stat(PendingFile(state)); !os.IsNotExist(err) {
		t.Fatal("corrupt update became pending")
	}
}

func TestGitHubElectronTransactionPreservesDataAndRollsBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(strconv.FormatBool(fail), func(t *testing.T) {
			root := t.TempDir()
			state := filepath.Join(root, "data/state")
			oldIdentity := []byte(`{"shell":"electron","distribution":"eduwork","productVersion":"0.3.6"}`)
			writeFixtureFile(t, filepath.Join(root, "resources/app/eduwork.desktop.json"), oldIdentity)
			writeFixtureFile(t, filepath.Join(root, "config/eduwork.jsonc"), []byte("organization configuration"))
			writeFixtureFile(t, filepath.Join(root, "config/eduwork.0.3.6.jsonc"), []byte("previous publisher configuration"))
			writeFixtureFile(t, filepath.Join(root, "data/dsh/sessions/history.json"), []byte("conversation history"))
			writeFixtureFile(t, filepath.Join(root, "data/state/update-preferences.json"), []byte(`{"policy":"development","source":"user"}`))
			writeFixtureFile(t, filepath.Join(root, "workspace/project.txt"), []byte("workspace content"))
			exe, _ := os.Executable()
			payload, err := os.ReadFile(exe)
			if err != nil {
				t.Fatal(err)
			}
			writeFixtureFile(t, filepath.Join(root, "EduWork-Electron.exe"), payload)
			files := map[string][]byte{"EduWork-Electron.exe": payload, "resources/app/eduwork.desktop.json": []byte(`{"shell":"electron","distribution":"eduwork","productVersion":"0.3.7"}`), "config/eduwork.jsonc": []byte("new default must not replace user"), "config/examples/new.jsonc": []byte("new example")}
			files["config/eduwork.0.3.7.jsonc"] = []byte("next publisher configuration")
			if fail {
				files["fail-electron"] = []byte("fail")
			}
			m := releaseManifest{SchemaVersion: 1, LauncherVersion: "0.3.7", Flavor: "offline", Launch: &releaseLaunch{Protocol: "eduwork-desktop/v1", Shell: "electron", Executable: "EduWork-Electron.exe", Migration: "wails-host-v1", Distribution: "eduwork"}}
			for name, data := range files {
				m.Files = append(m.Files, releaseFile{Path: name, Bytes: int64(len(data)), SHA256: fmt.Sprintf("%x", sha256.Sum256(data))})
			}
			zipPath := writeReleaseZIP(t, m, files)
			zipBytes, err := os.ReadFile(zipPath)
			if err != nil {
				t.Fatal(err)
			}
			config, _, _, _ := githubFixture(t, zipBytes)
			status, err := CheckBest(context.Background(), config, []string{"stable"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = Download(context.Background(), DownloadConfig{Provider: "github", GitHubRepository: config.GitHubRepository, Distribution: config.Distribution, Version: status.LatestVersion, Channel: status.Channel, StateDir: state, InstallDir: root, ExecutableName: "EduWork-Electron.exe", Artifact: status.Artifact, HTTPClient: config.HTTPClient, AllowShellMigration: true})
			if err != nil {
				t.Fatal(err)
			}
			pending, err := LoadPending(state)
			if err != nil {
				t.Fatal(err)
			}
			err = applyAndRestart(state, pending, nil)
			if fail {
				if err == nil || !strings.Contains(err.Error(), "health") {
					t.Fatal("failed health check was not rejected", err)
				}
				assertFileValue(t, filepath.Join(root, "resources/app/eduwork.desktop.json"), string(oldIdentity))
			} else {
				if err != nil {
					t.Fatal(err)
				}
				assertFileValue(t, filepath.Join(root, "resources/app/eduwork.desktop.json"), string(files["resources/app/eduwork.desktop.json"]))
			}
			assertFileValue(t, filepath.Join(root, "config/eduwork.jsonc"), "organization configuration")
			assertFileValue(t, filepath.Join(root, "config/eduwork.0.3.6.jsonc"), "previous publisher configuration")
			assertFileValue(t, filepath.Join(root, "config/eduwork.0.3.7.jsonc"), "next publisher configuration")
			assertFileValue(t, filepath.Join(root, "data/dsh/sessions/history.json"), "conversation history")
			assertFileValue(t, filepath.Join(root, "data/state/update-preferences.json"), `{"policy":"development","source":"user"}`)
			assertFileValue(t, filepath.Join(root, "workspace/project.txt"), "workspace content")
		})
	}
}
