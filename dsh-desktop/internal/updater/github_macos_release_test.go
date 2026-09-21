package updater

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestGitHubMacOnlyReleaseKeepsWindowsUpdatesAvailable(t *testing.T) {
	const version = "0.3.6-dev.20260921.1"
	config, _, _, _ := githubVersionFixture(t, []byte("windows archive"), version)
	config.Channel = "development"
	original := config.HTTPClient.Transport
	config.HTTPClient.Transport = githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		response, err := original.RoundTrip(req)
		if err != nil || req.URL.Host != "api.github.com" || req.URL.Query().Get("per_page") == "" {
			return response, err
		}
		defer response.Body.Close()
		var releases []githubRelease
		if err := json.NewDecoder(response.Body).Decode(&releases); err != nil {
			return nil, err
		}
		// A newer Mac-only prerelease intentionally has no Windows manifest.
		releases = append([]githubRelease{{Tag: "macos-v0.3.6-dev.20260921.2", Prerelease: true, PublishedAt: "2026-09-21T12:00:00Z"}}, releases...)
		body, err := json.Marshal(releases)
		if err != nil {
			return nil, err
		}
		response.Body = io.NopCloser(bytes.NewReader(body))
		response.ContentLength = int64(len(body))
		return response, nil
	})
	for _, current := range []string{"0.3.6-dev.20260915.1", version} {
		config.CurrentVersion = current
		status, err := checkGitHub(context.Background(), config)
		want := "available"
		if current == version {
			want = "up_to_date"
		}
		if err != nil || status.State != want || status.LatestVersion != version {
			t.Fatalf("Mac-only release broke Windows updates for %s: %+v, %v", current, status, err)
		}
	}
}
