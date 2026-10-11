package portable

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func replacementFixture(t *testing.T, content map[string]string) *Archive {
	t.Helper()
	content["EduWork-Electron.exe"] = "launcher"
	content["resources/app/eduwork.desktop.json"] = `{"shell":"electron","distribution":"eduwork"}`
	content["resources/update/EduWork-Updater.exe"] = "updater"
	m := Manifest{SchemaVersion: 1, Kind: "eduwork-portable-release", Version: "1.2.3", Distribution: "eduwork", Shell: "electron", Platform: "windows-x64"}
	for path, data := range content {
		m.Files = append(m.Files, File{Path: path, Bytes: int64(len(data)), SHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(data)))})
	}
	encoded, _ := json.Marshal(m)
	content["RELEASE-MANIFEST.json"] = string(encoded)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for path, data := range content {
		w, e := z.Create("EduWork/" + path)
		if e != nil {
			t.Fatal(e)
		}
		_, _ = w.Write([]byte(data))
	}
	if e := z.Close(); e != nil {
		t.Fatal(e)
	}
	id := Identity{Product: "EduWork", Root: "EduWork", Version: m.Version, Distribution: m.Distribution, Bytes: int64(buf.Len()), SHA256: fmt.Sprintf("%x", sha256.Sum256(buf.Bytes()))}
	a, e := Inspect(bytes.NewReader(buf.Bytes()), id)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func TestReplacePreservesPrivateAndUnknownFiles(t *testing.T) {
	old := replacementFixture(t, map[string]string{"old.txt": "old", "same.txt": "old", "config/user.json": "default", "data/sessions/a": "default"})
	target := filepath.Join(t.TempDir(), "应用")
	if _, e := old.Extract(context.Background(), target, nil); e != nil {
		t.Fatal(e)
	}
	for path, data := range map[string]string{"config/user.json": "my config", "data/sessions/a": "my session", "personal.txt": "mine", ".env": "private"} {
		if e := os.WriteFile(filepath.Join(target, filepath.FromSlash(path)), []byte(data), 0600); e != nil {
			t.Fatal(e)
		}
	}
	next := replacementFixture(t, map[string]string{"same.txt": "new", "config/user.json": "new defaults", "data/sessions/a": "new default", "config/example": "example"})
	if version, e := ExistingInstallation(target, next.Identity); e != nil || version != "1.2.3" {
		t.Fatalf("%s %v", version, e)
	}
	if _, e := next.Replace(context.Background(), target, nil); e != nil {
		t.Fatal(e)
	}
	for path, want := range map[string]string{"same.txt": "new", "config/user.json": "my config", "data/sessions/a": "my session", "config/example": "example", "personal.txt": "mine", ".env": "private"} {
		b, e := os.ReadFile(filepath.Join(target, filepath.FromSlash(path)))
		if e != nil || string(b) != want {
			t.Fatalf("%s got %q: %v", path, b, e)
		}
	}
	if _, e := os.Stat(filepath.Join(target, "old.txt")); !os.IsNotExist(e) {
		t.Fatal("stale managed file retained")
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Fatal("temporary files remain")
	}
}
func TestReplaceRefusesUnknownCollisionAndWrongEdition(t *testing.T) {
	for _, mode := range []string{"unknown", "edition", "cancel", "hash"} {
		t.Run(mode, func(t *testing.T) {
			old := replacementFixture(t, map[string]string{"same.txt": "old"})
			target := filepath.Join(t.TempDir(), "app")
			if _, e := old.Extract(context.Background(), target, nil); e != nil {
				t.Fatal(e)
			}
			next := replacementFixture(t, map[string]string{"same.txt": "new", "collision.txt": "new"})
			if mode == "unknown" {
				_ = os.WriteFile(filepath.Join(target, "collision.txt"), []byte("mine"), 0600)
			}
			if mode == "edition" {
				next.Identity.Distribution = "other"
			}
			if mode == "hash" {
				next.Manifest.Files[0].SHA256 = fmt.Sprintf("%064d", 0)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			_, e := next.Replace(ctx, target, func(p Progress) {
				if mode == "cancel" && p.Percent == 99 {
					cancel()
				}
			})
			if e == nil {
				t.Fatal("expected failure")
			}
			b, _ := os.ReadFile(filepath.Join(target, "same.txt"))
			if string(b) != "old" {
				t.Fatal("old app changed")
			}
			entries, _ := os.ReadDir(filepath.Dir(target))
			if len(entries) != 1 {
				t.Fatalf("temporary files remain: %v", entries)
			}
		})
	}
}
