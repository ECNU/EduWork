package builtin

import (
	"embed"
	"io/fs"
	"strings"
	"sync"
)

const SkillsRoot = "skills"
const MediaRoot = "media"

// embeddedFiles contains only small trusted manifests coupled to this exact
// launcher build. Python distributions, wheels, Skills and templates are
// deliberately external green-package resources.
//
//go:embed python-runtime-manifest.json node-runtime-manifest.json resources-manifest.json webview2-runtime-manifest.json
var embeddedFiles embed.FS

// ResourceFS overlays the verified external resource snapshot at product
// resource paths while keeping only small trusted manifests embedded.
// The exported value preserves the fs.FS/ReadFileFS/ReadDirFS contract used by
// existing projection code without putting Skill payloads into the executable.
type ResourceFS struct {
	mu       sync.RWMutex
	external fs.FS
}

var Files = &ResourceFS{}

func (r *ResourceFS) source(name string) fs.FS {
	if name == SkillsRoot || strings.HasPrefix(name, SkillsRoot+"/") ||
		name == MediaRoot || strings.HasPrefix(name, MediaRoot+"/") {
		r.mu.RLock()
		source := r.external
		r.mu.RUnlock()
		if source != nil {
			return source
		}
	}
	return embeddedFiles
}

func (r *ResourceFS) Open(name string) (fs.File, error) {
	return r.source(name).Open(name)
}

func (r *ResourceFS) ReadFile(name string) ([]byte, error) {
	return fs.ReadFile(r.source(name), name)
}

func (r *ResourceFS) ReadDir(name string) ([]fs.DirEntry, error) {
	return fs.ReadDir(r.source(name), name)
}

func (r *ResourceFS) setExternal(source fs.FS) {
	r.mu.Lock()
	r.external = source
	r.mu.Unlock()
}
