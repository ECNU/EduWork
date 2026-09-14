package updater

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGitHubCachePreservesWireBytesAndRevalidation(t *testing.T) {
	content := []byte("{\n  \"text\": \"<tag>&中文\",\n  \"value\": 1\n}\n")
	target := "https://github.com/example/product/releases/download/v1.0.0/update.json"
	cache := t.TempDir()
	calls := 0
	client := &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		calls++
		if calls == 2 {
			if req.Header.Get("If-None-Match") != "fixture-etag" {
				t.Fatal("missing revalidation ETag")
			}
			return &http.Response{StatusCode: 304, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(nil)), Request: req}, nil
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Etag": []string{"fixture-etag"}}, Body: io.NopCloser(bytes.NewReader(content)), Request: req}, nil
	})}
	check := func() {
		t.Helper()
		got, err := readGitHubJSON(context.Background(), client, target, cache)
		if err != nil || !bytes.Equal(got, content) {
			t.Fatalf("response bytes changed: %q, %v", got, err)
		}
	}
	check()
	check()
	if calls != 1 {
		t.Fatal("fresh response was not cached")
	}
	path := filepath.Join(cache, "github-cache", fmt.Sprintf("%x.json", sha256.Sum256([]byte(target))))
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved githubCache
	if err := json.Unmarshal(encoded, &saved); err != nil {
		t.Fatal(err)
	}
	saved.Until = time.Now().Add(-time.Minute)
	encoded, _ = json.Marshal(saved)
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	check()
	check()
	if calls != 2 {
		t.Fatal("revalidated response was not cached")
	}
}

func TestGitHubCacheRefetchesLegacyCompactedBody(t *testing.T) {
	target := "https://github.com/example/product/releases/download/v1.0.0/update.json"
	cache := t.TempDir()
	path := filepath.Join(cache, "github-cache", fmt.Sprintf("%x.json", sha256.Sum256([]byte(target))))
	legacy, _ := json.Marshal(map[string]any{"until": time.Now().Add(time.Minute), "etag": "old-etag", "body": json.RawMessage(`{"version":1}`)})
	writeFixtureFile(t, path, legacy)
	content := []byte("{\n \"version\": 1\n}\n")
	calls := 0
	client := &http.Client{Transport: githubRoundTrip(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Header.Get("If-None-Match") != "" {
			t.Fatal("legacy bytes must not be reused on HTTP 304")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(content)), Request: req}, nil
	})}
	got, err := readGitHubJSON(context.Background(), client, target, cache)
	if err != nil || !bytes.Equal(got, content) || calls != 1 {
		t.Fatalf("legacy cache was reused: %q %v calls=%d", got, err, calls)
	}
}
