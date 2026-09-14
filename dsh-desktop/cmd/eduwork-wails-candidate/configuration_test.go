package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigurationOpeningUsesOnlyDesktopPaths(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "中文 空格.jsonc")
	if err := os.WriteFile(config, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "examples"), 0700); err != nil {
		t.Fatal(err)
	}
	var paths []string
	handler := configurationHandler(config, func(path string, text bool) error { paths = append(paths, path); return nil })
	for _, row := range []struct {
		body   string
		status int
	}{
		{`{"target":"config"}`, 204}, {`{"target":"examples"}`, 204},
		{`{"target":"../secret"}`, 400}, {`{"target":"config","path":"C:/other"}`, 400}, {`{"target":"config"} {}`, 400},
	} {
		req := httptest.NewRequest("POST", "/", strings.NewReader(row.body))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != row.status {
			t.Fatalf("%s: %d", row.body, res.Code)
		}
	}
	if len(paths) != 2 || paths[0] != config || paths[1] != filepath.Join(root, "examples") {
		t.Fatalf("unexpected paths %v", paths)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"target":"config"}`))
	req.Header.Set("Origin", "https://example.org")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != 403 {
		t.Fatal(res.Code)
	}
}
