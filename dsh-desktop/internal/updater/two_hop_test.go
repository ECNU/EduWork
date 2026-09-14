package updater

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Keep the legacy feed on the final Go bridge. Only clients that explicitly
// opt into the bridge feed may discover an Electron payload.
func TestTwoHopReleaseChannels(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		base, version, shell := "/releases", "0.3.1", "wails"
		if strings.HasPrefix(r.URL.Path, "/releases-bridge/") {
			base, version, shell = "/releases-bridge", "0.3.2", "electron"
		}
		channel := "stable"
		if strings.Contains(r.URL.Path, "/development/") {
			channel = "development"
		}
		url := server.URL + base + "/" + channel + "/" + version + "/desktop.zip"
		_ = json.NewEncoder(w).Encode(Manifest{SchemaVersion: 1, Channel: channel,
			Version: version, Target: "windows-amd64", Artifacts: []Artifact{{
				Flavor: "offline", FileName: "desktop.zip", Bytes: 1,
				SHA256: strings.Repeat("a", 64), URL: url, Shell: shell,
			}}})
	}))
	defer server.Close()
	for _, version := range []string{"0.2.0-dev.20260831.1", "0.2.0-dev.20260909.3", "0.3.0", "0.3.1", "0.3.2"} {
		for _, channel := range []string{"stable", "development"} {
			config := Config{ManifestBaseURL: server.URL + "/releases", Channel: channel,
				CurrentVersion: version, Target: "windows-amd64", Flavor: "offline", HTTPClient: server.Client()}
			status, err := Check(context.Background(), config)
			want := "available"
			if comparison, _ := CompareVersions(version, "0.3.1"); comparison >= 0 {
				want = "up_to_date"
			}
			if err != nil || status.State != want || status.LatestVersion != "0.3.1" || status.Artifact.Shell != "wails" {
				t.Fatalf("legacy %s/%s: %+v, %v", version, channel, status, err)
			}
			config.ManifestBaseURL = server.URL + "/releases-bridge"
			if _, err := Check(context.Background(), config); err == nil {
				t.Fatal("unqualified client accepted Electron")
			}
			config.AllowShellMigration = true
			status, err = Check(context.Background(), config)
			want = "available"
			if version == "0.3.2" {
				want = "up_to_date"
			}
			if err != nil || status.State != want || status.LatestVersion != "0.3.2" || status.Artifact.Shell != "electron" {
				t.Fatalf("bridge %s/%s: %+v, %v", version, channel, status, err)
			}
		}
	}
}
