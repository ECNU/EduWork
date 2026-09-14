//go:build windows

package webviewruntime

import (
	"os"
	"strings"
	"testing"

	"github.com/wailsapp/go-webview2/webviewloader"
)

// This integration check is opt-in because the 300+ MiB Microsoft runtime is
// a release asset, not a source-tree dependency. Assembly verification sets
// CHATECNU_TEST_WEBVIEW2_ROOT to exercise the same loader used by Wails.
func TestPinnedRuntimeCanBeLoadedByWebView2Loader(t *testing.T) {
	root := os.Getenv("CHATECNU_TEST_WEBVIEW2_ROOT")
	if strings.TrimSpace(root) == "" {
		t.Skip("private WebView2 release asset not supplied")
	}
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	version, err := webviewloader.GetAvailableCoreWebView2BrowserVersionString(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(version, manifest.Version) {
		t.Fatalf("loader returned WebView2 version %q, want %q", version, manifest.Version)
	}
}
