package updater

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestGitHubDevelopmentChannelAndStablePromotion(t *testing.T) {
	for _, stableVersion := range []string{"0.3.5", "0.3.7"} {
		t.Run(stableVersion, func(t *testing.T) {
			stable, _, _, _ := githubVersionFixture(t, []byte("stable zip"), stableVersion)
			dev, _, _, _ := githubVersionFixture(t, []byte("dev zip"), "0.3.7-dev.20260914.2")
			stableHTTP, devHTTP := stable.HTTPClient, dev.HTTPClient
			dev.HTTPClient = &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
				if strings.HasSuffix(req.URL.Path, "/latest") || strings.Contains(req.URL.Path, "/v"+stableVersion+"/") {
					return stableHTTP.Transport.RoundTrip(req)
				}
				return devHTTP.Transport.RoundTrip(req)
			})}
			status, err := CheckBest(context.Background(), dev, []string{"stable", "development"})
			expected := "0.3.7-dev.20260914.2"
			if stableVersion == "0.3.7" {
				expected = stableVersion
			}
			if err != nil || status.LatestVersion != expected || status.State != "available" {
				t.Fatalf("%+v %v", status, err)
			}
			stableOnly, err := CheckBest(context.Background(), dev, []string{"stable"})
			if err != nil || stableOnly.LatestVersion != stableVersion || stableOnly.Channel != "stable" {
				t.Fatalf("stable selected development: %+v %v", stableOnly, err)
			}
			dev.CurrentVersion = "0.3.8"
			status, err = CheckBest(context.Background(), dev, []string{"stable", "development"})
			if err != nil || status.State != "up_to_date" {
				t.Fatalf("downgrade: %+v %v", status, err)
			}
		})
	}
}

func TestGitHubDevelopmentWithoutStableAndVerifiedDownload(t *testing.T) {
	config, _, _, _ := githubVersionFixture(t, []byte("development archive"), "0.3.7-dev.20260914.2")
	base := config.HTTPClient.Transport
	config.HTTPClient = &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Path, "/latest") {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("not found")), Request: req}, nil
		}
		return base.RoundTrip(req)
	})}
	status, err := CheckBest(context.Background(), config, []string{"stable", "development"})
	if err != nil || status.Channel != "development" || status.State != "available" {
		t.Fatalf("%+v %v", status, err)
	}
	result, err := Download(context.Background(), DownloadConfig{Provider: "github", GitHubRepository: config.GitHubRepository, Distribution: config.Distribution, Version: status.LatestVersion, Channel: status.Channel, StateDir: t.TempDir(), InstallDir: t.TempDir(), ExecutableName: "EduWork-Electron.exe", Artifact: status.Artifact, HTTPClient: config.HTTPClient, AllowShellMigration: true})
	if err != nil || result.State != "ready" {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestGitHubDevelopmentPaginationFiltersAndSemVer(t *testing.T) {
	config, _, _, _ := githubVersionFixture(t, []byte("archive"), "0.3.7-dev.20260914.2")
	config.Channel = "development"
	base := config.HTTPClient.Transport
	config.HTTPClient = &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		response, err := base.RoundTrip(req)
		if err != nil || req.URL.Query().Get("page") != "1" {
			return response, err
		}
		var rows []githubRelease
		if err := json.NewDecoder(response.Body).Decode(&rows); err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		valid := rows[0]
		rows = make([]githubRelease, 20)
		for i := range rows {
			rows[i] = valid
			rows[i].Tag = "v0.3.9-dev.20260914.9"
			rows[i].Draft = true
		}
		rows[0] = valid
		rows[0].Tag = "v0.3.7-dev.20260914.1"
		rows[1] = valid
		rows[1].Tag = "v9.9.9-rc.1"
		rows[2] = valid
		rows[2].Tag = "v9.9.9-dev.20260914.1"
		rows[2].PublishedAt = ""
		rows[3] = valid
		rows[3].Tag = "v9.9.9-dev.20260914.1"
		rows[3].Prerelease = false
		body, _ := json.Marshal(rows)
		response.Body = io.NopCloser(strings.NewReader(string(body)))
		return response, nil
	})}
	status, err := Check(context.Background(), config)
	if err != nil || status.LatestVersion != "0.3.7-dev.20260914.2" {
		t.Fatalf("%+v %v", status, err)
	}
}
