package webviewruntime

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLoadManifestPinsOfficialFixedRuntime(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != "151.0.4129.93" || manifest.RuntimeID != "webview2-fixed-151.0.4129.93" {
		t.Fatalf("unexpected WebView2 identity: %+v", manifest)
	}
	asset := manifest.Assets["windows-amd64"]
	if asset.SHA256 != "1cb7106545f5aee92ee16496347a0e775a351cb5a3816d072f04323695899bde" || !strings.HasSuffix(asset.URL, asset.Archive) {
		t.Fatalf("unexpected WebView2 asset: %+v", asset)
	}
}

func TestManifestRejectsUntrustedAsset(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	asset := manifest.Assets["windows-amd64"]
	asset.URL = "https://example.com/" + asset.Archive
	manifest.Assets["windows-amd64"] = asset
	if err := manifest.Validate(); err == nil {
		t.Fatal("untrusted WebView2 host accepted")
	}
}

func TestResolveUsesPortableDataRuntime(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("WebView2 is a Windows desktop runtime")
	}
	data := t.TempDir()
	browser := filepath.Join(data, "runtime", "webview2", "151.0.4129.93", "msedgewebview2.exe")
	if err := os.MkdirAll(filepath.Dir(browser), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(browser, []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	installation, err := Resolve(data)
	if err != nil {
		t.Fatal(err)
	}
	if installation.Browser != browser || installation.Root != filepath.Dir(browser) {
		t.Fatalf("unexpected WebView2 installation: %+v", installation)
	}
}

func TestCleanupKeepsCurrentAndOneRollbackVersion(t *testing.T) {
	data := t.TempDir()
	root := filepath.Join(data, "runtime", "webview2")
	for _, version := range []string{"149.0.1.0", "150.0.2.0", "151.0.4129.93", "notes"} {
		if err := os.MkdirAll(filepath.Join(root, version), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := CleanupOld(data, "151.0.4129.93"); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"150.0.2.0", "151.0.4129.93", "notes"} {
		if _, err := os.Stat(filepath.Join(root, version)); err != nil {
			t.Fatalf("expected retained directory %s: %v", version, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "149.0.1.0")); !os.IsNotExist(err) {
		t.Fatalf("old WebView2 runtime was not removed: %v", err)
	}
}
