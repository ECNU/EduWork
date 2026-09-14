package builtin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing/fstest"
)

const resourceManifestSchemaVersion = 1

type externalResourceManifest struct {
	SchemaVersion int               `json:"schemaVersion"`
	Files         map[string]string `json:"files"`
}

// ConfigureResources loads the external resources tree, verifies its exact
// file set against the manifest coupled to this launcher, then keeps an
// immutable in-memory snapshot. Skill and template bytes remain ordinary files in
// the green package; they are not linked into the executable.
func ConfigureResources(resourcesRoot string) error {
	root, err := filepath.Abs(strings.TrimSpace(resourcesRoot))
	if err != nil {
		return fmt.Errorf("resolve ChatECNU Work resources directory: %w", err)
	}
	root = filepath.Clean(root)
	if err := requireRealDirectory(root, "resources"); err != nil {
		return err
	}
	for name, label := range map[string]string{
		SkillsRoot: "skills resources",
		MediaRoot:  "media resources",
	} {
		if err := requireRealDirectory(filepath.Join(root, name), label); err != nil {
			return err
		}
	}

	manifest, err := loadExternalResourceManifest()
	if err != nil {
		return err
	}
	source := os.DirFS(root)
	snapshot := fstest.MapFS{}
	actual := make(map[string]string, len(manifest.Files))
	err = fs.WalkDir(source, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			return fmt.Errorf("external resource contains a symbolic link: %s", name)
		}
		if entry.IsDir() {
			// Python may create this cache while package tests exercise a managed
			// script. It is never shipped or trusted as a product resource.
			if filepath.Base(name) == "__pycache__" {
				return fs.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("external resource is not a regular file: %s", name)
		}
		data, err := fs.ReadFile(source, name)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(data)
		actual[name] = hex.EncodeToString(digest[:])
		snapshot[name] = &fstest.MapFile{Data: append([]byte(nil), data...), Mode: 0o444}
		return nil
	})
	if err != nil {
		return fmt.Errorf("read external resources: %w", err)
	}
	if err := compareExternalResourceFiles(manifest.Files, actual); err != nil {
		return err
	}
	Files.setExternal(snapshot)
	return nil
}

func loadExternalResourceManifest() (externalResourceManifest, error) {
	data, err := embeddedFiles.ReadFile("resources-manifest.json")
	if err != nil {
		return externalResourceManifest{}, fmt.Errorf("read embedded resource manifest: %w", err)
	}
	var manifest externalResourceManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return externalResourceManifest{}, fmt.Errorf("parse embedded resource manifest: %w", err)
	}
	if manifest.SchemaVersion != resourceManifestSchemaVersion || len(manifest.Files) == 0 {
		return externalResourceManifest{}, errors.New("embedded resource manifest is empty or unsupported")
	}
	for name, digest := range manifest.Files {
		allowedRoot := name == SkillsRoot || strings.HasPrefix(name, SkillsRoot+"/") ||
			name == MediaRoot || strings.HasPrefix(name, MediaRoot+"/")
		if !fs.ValidPath(name) || !allowedRoot || strings.Contains(name, "\\") {
			return externalResourceManifest{}, fmt.Errorf("invalid external resource manifest path %q", name)
		}
		if len(digest) != sha256.Size*2 {
			return externalResourceManifest{}, fmt.Errorf("invalid external resource digest for %s", name)
		}
		if _, err := hex.DecodeString(digest); err != nil {
			return externalResourceManifest{}, fmt.Errorf("invalid external resource digest for %s", name)
		}
	}
	return manifest, nil
}

func compareExternalResourceFiles(expected, actual map[string]string) error {
	for name, expectedDigest := range expected {
		actualDigest, ok := actual[name]
		if !ok {
			return fmt.Errorf("external resource is missing: %s", name)
		}
		if !strings.EqualFold(expectedDigest, actualDigest) {
			return fmt.Errorf("external resource failed integrity verification: %s", name)
		}
	}
	for name := range actual {
		if _, ok := expected[name]; !ok {
			return fmt.Errorf("external resource is not declared by this launcher: %s", name)
		}
	}
	return nil
}

func requireRealDirectory(path, label string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("read ChatECNU Work %s directory: %w", label, err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("ChatECNU Work %s path must be a real directory: %s", label, path)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("resolve ChatECNU Work %s directory: %w", label, err)
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return err
	}
	if !sameResourcePath(path, resolved) {
		return fmt.Errorf("ChatECNU Work %s directory must not traverse a link or junction: %s", label, path)
	}
	return nil
}

func sameResourcePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if os.PathSeparator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

// Test binaries load the repository resource tree explicitly so package tests
// exercise the same external-file path as a green distribution. Production
// executables never search their current directory from an init hook.
func init() {
	name := strings.ToLower(filepath.Base(os.Args[0]))
	if !strings.HasSuffix(name, ".test") && !strings.HasSuffix(name, ".test.exe") {
		return
	}
	root, ok := findTestResources()
	if !ok {
		return
	}
	if err := ConfigureResources(root); err != nil {
		panic(err)
	}
}

func findTestResources() (string, bool) {
	directory, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for range 10 {
		candidate := filepath.Join(directory, "runtime-resources")
		if info, err := os.Stat(filepath.Join(candidate, SkillsRoot)); err == nil && info.IsDir() {
			return candidate, true
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", false
}
