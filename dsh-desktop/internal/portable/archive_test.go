package portable

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T, mutate func(*Manifest), extra map[string]string) ([]byte, Identity) {
	t.Helper()
	files := map[string]string{"EduWork-Electron.exe": "synthetic launcher", "resources/app/eduwork.desktop.json": "{}", "resources/update/EduWork-Updater.exe": "synthetic updater", "resources/" + strings.Repeat("nested/", 32) + "file.txt": "long path evidence"}
	m := Manifest{SchemaVersion: 1, Kind: "eduwork-portable-release", Version: "1.2.3", Distribution: "eduwork", Shell: "electron", Platform: "windows-x64"}
	for p, v := range files {
		h := sha256.Sum256([]byte(v))
		m.Files = append(m.Files, File{p, int64(len(v)), hex.EncodeToString(h[:])})
	}
	if mutate != nil {
		mutate(&m)
	}
	data, _ := json.Marshal(m)
	files["RELEASE-MANIFEST.json"] = string(data)
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for p, v := range files {
		w, e := z.Create("EduWork/" + p)
		if e != nil {
			t.Fatal(e)
		}
		_, _ = w.Write([]byte(v))
	}
	for p, v := range extra {
		w, e := z.Create(p)
		if e != nil {
			t.Fatal(e)
		}
		_, _ = w.Write([]byte(v))
	}
	if e := z.Close(); e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(b.Bytes())
	return b.Bytes(), Identity{Product: "EduWork", Root: "EduWork", Version: "1.2.3", Distribution: "eduwork", SHA256: hex.EncodeToString(h[:]), Bytes: int64(b.Len())}
}
func TestExtractLongUnicodePathAndRefuseOverwrite(t *testing.T) {
	b, id := fixture(t, nil, nil)
	a, e := Inspect(bytes.NewReader(b), id)
	if e != nil {
		t.Fatal(e)
	}
	parent := filepath.Join(t.TempDir(), "中文 空格目录")
	if e = os.Mkdir(parent, 0700); e != nil {
		t.Fatal(e)
	}
	target := filepath.Join(parent, "EduWork")
	if _, e = a.Extract(context.Background(), target, nil); e != nil {
		t.Fatal(e)
	}
	longest := ""
	for _, f := range a.Manifest.Files {
		p := filepath.Join(target, filepath.FromSlash(f.Path))
		got, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		if int64(len(got)) != f.Bytes {
			t.Fatal("wrong size")
		}
		if len(p) > len(longest) {
			longest = p
		}
	}
	if len(longest) <= 260 {
		t.Fatalf("test must exceed MAX_PATH: %d", len(longest))
	}
	marker := filepath.Join(target, "personal-data.txt")
	_ = os.WriteFile(marker, []byte("keep"), 0600)
	if _, e = a.Extract(context.Background(), target, nil); e == nil {
		t.Fatal("overwrote existing directory")
	}
	if got, _ := os.ReadFile(marker); string(got) != "keep" {
		t.Fatal("existing data changed")
	}
}
func TestCancellationAndHashFailureCleanOnlyStaging(t *testing.T) {
	for _, name := range []string{"cancel", "hash"} {
		t.Run(name, func(t *testing.T) {
			var mutate func(*Manifest)
			if name == "hash" {
				mutate = func(m *Manifest) { m.Files[0].SHA256 = strings.Repeat("0", 64) }
			}
			b, id := fixture(t, mutate, nil)
			a, e := Inspect(bytes.NewReader(b), id)
			if e != nil {
				t.Fatal(e)
			}
			parent := t.TempDir()
			marker := filepath.Join(parent, "keep.txt")
			_ = os.WriteFile(marker, []byte("keep"), 0600)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			_, e = a.Extract(ctx, filepath.Join(parent, "EduWork"), func(p Progress) {
				if name == "cancel" {
					cancel()
				}
			})
			if e == nil {
				t.Fatal("expected failure")
			}
			entries, _ := os.ReadDir(parent)
			if len(entries) != 1 || entries[0].Name() != "keep.txt" {
				t.Fatalf("left unexpected files: %v", entries)
			}
		})
	}
}
func TestRejectUnsafeArchiveAndManifest(t *testing.T) {
	for _, name := range []string{"EduWork/../escape", "EduWork/a:stream", "EduWork/CON.txt", "EduWork/dot. /x", "Other/file", "EduWork/RESOURCES/APP/EDUWORK.DESKTOP.JSON", "EduWork/undeclared"} {
		t.Run(name, func(t *testing.T) {
			b, id := fixture(t, nil, map[string]string{name: "bad"})
			if _, e := Inspect(bytes.NewReader(b), id); e == nil {
				t.Fatal("accepted unsafe ZIP")
			}
		})
	}
	for _, mutate := range []func(*Manifest){func(m *Manifest) { m.Version = "other" }, func(m *Manifest) { m.Files[0].Path = "../escape" }, func(m *Manifest) { m.Files[0].Bytes++ }, func(m *Manifest) { m.Files = append(m.Files, m.Files[0]) }} {
		b, id := fixture(t, mutate, nil)
		if _, e := Inspect(bytes.NewReader(b), id); e == nil {
			t.Fatal("accepted invalid manifest")
		}
	}
}
func TestPayloadAndDigest(t *testing.T) {
	b, id := fixture(t, nil, nil)
	if e := Verify(context.Background(), bytes.NewReader(b), id, nil); e != nil {
		t.Fatal(e)
	}
	bad := append([]byte(nil), b...)
	bad[0] ^= 1
	if e := Verify(context.Background(), bytes.NewReader(bad), id, nil); e == nil {
		t.Fatal("accepted corrupt payload")
	}
	f, e := os.CreateTemp(t.TempDir(), "sfx")
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	_, _ = f.Write([]byte("stub"))
	_, _ = f.Write(b)
	footer := make([]byte, FooterSize)
	copy(footer, Magic)
	binary.LittleEndian.PutUint64(footer[16:], 4)
	binary.LittleEndian.PutUint64(footer[24:], uint64(len(b)))
	_, _ = f.Write(footer)
	r, e := Payload(f, id.Bytes)
	if e != nil {
		t.Fatal(e)
	}
	if e := Verify(context.Background(), r, id, nil); e != nil {
		t.Fatal(e)
	}
	_, _ = f.WriteAt([]byte{255}, int64(4+len(b)+16))
	if _, e = Payload(f, id.Bytes); e == nil {
		t.Fatal("accepted invalid footer")
	}
}
