package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkbenchUsesFixedNativeConfiguration(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	host, err := filepath.Abs("../../../dsh-host")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	config := filepath.Join(root, "配置 with spaces.jsonc")
	if err := os.WriteFile(config, []byte(`{"schemaVersion":1,"product":{"name":"EduWork"},"organizations":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	handler := workbenchHandler(node, host, config, "0.3.0-rc.3", root, root, filepath.Join(root, "product"), root)
	for _, action := range []string{"status", "diagnostics", "check-updates"} {
		request := httptest.NewRequest("POST", "/", strings.NewReader(`{"action":"`+action+`"}`))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("%s: HTTP %d: %s", action, response.Code, response.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["shell"] != "wails" {
			t.Fatalf("unexpected shell: %v", body)
		}
		if action == "diagnostics" {
			archive, err := base64.StdEncoding.DecodeString(body["archive"].(string))
			if err != nil {
				t.Fatal(err)
			}
			reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
			if err != nil {
				t.Fatal(err)
			}
			if len(reader.File) < 4 || !strings.HasSuffix(body["filename"].(string), ".zip") {
				t.Fatal("missing diagnostic ZIP payload")
			}
		}
	}
	for _, payload := range []string{`{"action":"execute"}`, `{"action":"status","path":"unowned"}`} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "/", strings.NewReader(payload)))
		if response.Code != 400 {
			t.Fatal("invalid operation was accepted")
		}
	}
}
