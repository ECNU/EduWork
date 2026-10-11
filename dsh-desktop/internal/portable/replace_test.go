package portable

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
				if mode == "cancel" && p.Message == "正在替换应用文件，保留配置和数据…" {
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

func TestReplaceBatchesOnlyOwnedDirectories(t *testing.T) {
	old := replacementFixture(t, map[string]string{
		"resources/runtime/a": "old a", "resources/runtime/b": "old b", "resources/runtime/stale": "old",
		"resources/shared/program": "old program", "retired/component": "old component",
	})
	target := filepath.Join(t.TempDir(), "app")
	if _, err := old.Extract(context.Background(), target, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "resources/shared/personal"), []byte("mine"), 0600); err != nil {
		t.Fatal(err)
	}
	empty := filepath.Join(target, "resources/empty-user-directory")
	if err := os.Mkdir(empty, 0700); err != nil {
		t.Fatal(err)
	}
	next := replacementFixture(t, map[string]string{
		"resources/runtime/a": "new a", "resources/runtime/b": "new b",
		"resources/shared/program": "new program", "resources/new/component": "new component",
	})
	root, err := os.OpenRoot(target)
	if err != nil {
		t.Fatal(err)
	}
	units, err := replacementPlan(context.Background(), root, old.Manifest, next.Manifest, nil)
	root.Close()
	if err != nil {
		t.Fatal(err)
	}
	batched := map[string]bool{}
	for _, unit := range units {
		batched[unit.name] = unit.dir
	}
	if !batched["resources/runtime"] || !batched["retired"] || !batched["resources/new"] {
		t.Fatalf("owned directories not batched: %+v", units)
	}
	if batched["resources"] || batched["resources/shared"] {
		t.Fatal("directory with user files was batched")
	}
	last, replacementUpdates := -1, 0
	if _, err := next.Replace(context.Background(), target, func(p Progress) {
		if p.Percent < last {
			t.Errorf("progress went backwards: %d -> %d (%s)", last, p.Percent, p.Message)
		}
		last = p.Percent
		if strings.HasPrefix(p.Message, "正在替换应用文件…") {
			replacementUpdates++
		}
	}); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{
		"resources/runtime/a": "new a", "resources/runtime/b": "new b",
		"resources/shared/program": "new program", "resources/shared/personal": "mine",
		"resources/new/component": "new component",
	} {
		got, err := os.ReadFile(filepath.Join(target, filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Fatalf("%s: %q (%v)", name, got, err)
		}
	}
	if _, err := os.Stat(empty); err != nil {
		t.Fatal("user's empty directory was lost", err)
	}
	for _, name := range []string{"resources/runtime/stale", "retired"} {
		if _, err := os.Stat(filepath.Join(target, name)); !os.IsNotExist(err) {
			t.Fatalf("stale program retained: %s", name)
		}
	}
	if last != 100 || replacementUpdates < 2 {
		t.Fatal("missing replacement progress updates")
	}
}

func TestReplaceCancellationRestoresBatchedDirectory(t *testing.T) {
	old := replacementFixture(t, map[string]string{"resources/runtime/a": "old a", "resources/runtime/stale": "old stale"})
	target := filepath.Join(t.TempDir(), "app")
	if _, err := old.Extract(context.Background(), target, nil); err != nil {
		t.Fatal(err)
	}
	next := replacementFixture(t, map[string]string{"resources/runtime/a": "new a", "config/new-default": "default"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	canceled := false
	_, err := next.Replace(ctx, target, func(p Progress) {
		if strings.HasPrefix(p.Message, "正在替换应用文件…") {
			b, _ := os.ReadFile(filepath.Join(target, "resources/runtime/a"))
			if string(b) == "new a" {
				canceled = true
				cancel()
			}
		}
	})
	if !canceled || !errors.Is(err, context.Canceled) {
		t.Fatalf("expected mid-replacement cancellation: %v", err)
	}
	for name, want := range map[string]string{"resources/runtime/a": "old a", "resources/runtime/stale": "old stale"} {
		b, err := os.ReadFile(filepath.Join(target, name))
		if err != nil || string(b) != want {
			t.Fatalf("rollback %s: %q (%v)", name, b, err)
		}
	}
	if _, err := os.Stat(filepath.Join(target, "config/new-default")); !os.IsNotExist(err) {
		t.Fatal("canceled install left new defaults")
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Fatal("temporary files remain")
	}
}
