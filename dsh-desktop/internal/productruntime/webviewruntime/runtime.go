// Package webviewruntime locates the private Microsoft WebView2 Fixed Version
// Runtime shipped with the portable Windows desktop. It never installs or
// updates a machine-wide WebView2 runtime.
package webviewruntime

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/productruntime/builtin"
)

const ManifestSchemaVersion = 1

type Manifest struct {
	SchemaVersion int              `json:"schemaVersion"`
	RuntimeID     string           `json:"runtimeId"`
	Distribution  string           `json:"distribution"`
	Version       string           `json:"version"`
	Assets        map[string]Asset `json:"assets"`
}

type Asset struct {
	URL         string `json:"url"`
	SHA256      string `json:"sha256"`
	Archive     string `json:"archive"`
	ArchiveRoot string `json:"archiveRoot"`
}

type Installation struct {
	Version string
	Root    string
	Browser string
}

func LoadManifest() (Manifest, error) {
	payload, err := builtin.Files.ReadFile("webview2-runtime-manifest.json")
	if err != nil {
		return Manifest{}, fmt.Errorf("read embedded WebView2 runtime manifest: %w", err)
	}
	var manifest Manifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse embedded WebView2 runtime manifest: %w", err)
	}
	if err := manifest.Validate(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func PlatformKey() string { return runtime.GOOS + "-" + runtime.GOARCH }

func (m Manifest) CurrentAsset() (Asset, error) {
	asset, ok := m.Assets[PlatformKey()]
	if !ok {
		return Asset{}, fmt.Errorf("WebView2 Fixed Runtime is not available for %s", PlatformKey())
	}
	return asset, nil
}

func (m Manifest) Validate() error {
	if m.SchemaVersion != ManifestSchemaVersion {
		return fmt.Errorf("unsupported WebView2 runtime manifest schema %d", m.SchemaVersion)
	}
	if m.Distribution != "Microsoft Edge WebView2 Fixed Version Runtime" {
		return fmt.Errorf("unsupported WebView2 distribution %q", m.Distribution)
	}
	if _, ok := parseVersion(m.Version); !ok {
		return fmt.Errorf("invalid WebView2 version %q", m.Version)
	}
	if m.RuntimeID != "webview2-fixed-"+m.Version {
		return fmt.Errorf("WebView2 runtimeId %q does not match version %q", m.RuntimeID, m.Version)
	}
	if len(m.Assets) != 1 {
		return errors.New("WebView2 runtime manifest must pin exactly one Windows asset")
	}
	asset, ok := m.Assets["windows-amd64"]
	if !ok {
		return errors.New("WebView2 runtime manifest has no windows-amd64 asset")
	}
	parsed, err := url.Parse(strings.TrimSpace(asset.URL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "msedge.sf.dl.delivery.mp.microsoft.com" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("WebView2 asset must use the locked Microsoft HTTPS delivery host")
	}
	wantArchive := "Microsoft.WebView2.FixedVersionRuntime." + m.Version + ".x64.cab"
	if asset.Archive != wantArchive || path.Base(parsed.Path) != wantArchive || asset.ArchiveRoot != strings.TrimSuffix(wantArchive, ".cab") {
		return fmt.Errorf("WebView2 archive identity does not match %q", wantArchive)
	}
	if len(asset.SHA256) != 64 || strings.ToLower(asset.SHA256) != asset.SHA256 {
		return errors.New("WebView2 asset must have a lowercase SHA-256")
	}
	for _, character := range asset.SHA256 {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return errors.New("WebView2 asset must have a lowercase SHA-256")
		}
	}
	return nil
}

func Resolve(dataRoot string) (Installation, error) {
	manifest, err := LoadManifest()
	if err != nil {
		return Installation{}, err
	}
	if runtime.GOOS != "windows" {
		return Installation{}, fmt.Errorf("private WebView2 runtime is not supported on %s", runtime.GOOS)
	}
	root, err := filepath.Abs(filepath.Join(dataRoot, "runtime", "webview2", manifest.Version))
	if err != nil {
		return Installation{}, fmt.Errorf("resolve private WebView2 path: %w", err)
	}
	if strings.HasPrefix(root, `\\`) {
		return Installation{}, errors.New("WebView2 Fixed Runtime cannot run from a network path")
	}
	browser := filepath.Join(root, "msedgewebview2.exe")
	info, err := os.Stat(browser)
	if err != nil {
		return Installation{}, fmt.Errorf("private WebView2 executable is missing: %w", err)
	}
	if !info.Mode().IsRegular() {
		return Installation{}, fmt.Errorf("private WebView2 executable is not a regular file: %s", browser)
	}
	return Installation{Version: manifest.Version, Root: root, Browser: browser}, nil
}

// CleanupOld keeps the runtime used by this executable and at most one other
// version for updater rollback. Unknown directories are left alone.
func CleanupOld(dataRoot, currentVersion string) error {
	root := filepath.Join(dataRoot, "runtime", "webview2")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	type candidate struct {
		name  string
		parts [4]int
	}
	versions := make([]candidate, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		parts, ok := parseVersion(entry.Name())
		if !ok {
			continue
		}
		versions = append(versions, candidate{name: entry.Name(), parts: parts})
	}
	sort.Slice(versions, func(i, j int) bool {
		for part := range versions[i].parts {
			if versions[i].parts[part] != versions[j].parts[part] {
				return versions[i].parts[part] > versions[j].parts[part]
			}
		}
		return false
	})
	keep := map[string]bool{currentVersion: true}
	for _, version := range versions {
		if version.name != currentVersion {
			keep[version.name] = true
			break
		}
	}
	for _, version := range versions {
		if keep[version.name] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, version.name)); err != nil {
			return fmt.Errorf("remove old WebView2 runtime %s: %w", version.name, err)
		}
	}
	return nil
}

func parseVersion(value string) ([4]int, bool) {
	var parsed [4]int
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) != len(parsed) {
		return parsed, false
	}
	for index, part := range parts {
		if part == "" {
			return parsed, false
		}
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return parsed, false
		}
		parsed[index] = number
	}
	return parsed, true
}
