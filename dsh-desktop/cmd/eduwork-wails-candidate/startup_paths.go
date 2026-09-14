package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func migrationFailure(err error, output []byte) error {
	detail := strings.TrimSpace(string(output))
	if detail != "" {
		detail = "\n" + detail
	}
	return fmt.Errorf("历史数据迁移未完成，原数据仍保留：%w%s", err, detail)
}

// WebView creates its cache before OnStartup. Keep a fresh cache outside the
// DSH home, which must remain absent until the atomic legacy import completes.
// Established installations keep their existing browser preferences.
func startupWebviewPath(home string) string {
	legacy := filepath.Join(home, "webview2")
	if cache, err := os.Stat(legacy); err == nil && cache.IsDir() {
		for _, name := range []string{".eduwork-desktop-home.json", ".eduwork-migration.json"} {
			if marker, err := os.Stat(filepath.Join(home, name)); err == nil && !marker.IsDir() {
				return legacy
			}
		}
	}
	return filepath.Join(filepath.Dir(home), "webview2")
}
