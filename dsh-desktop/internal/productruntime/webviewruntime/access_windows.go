//go:build windows

package webviewruntime

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const accessMarker = ".chatecnu-webview2-access-v1"

// EnsureReadAccess applies Microsoft's required Fixed Runtime ACLs for
// unpackaged Windows applications. It changes only this private runtime tree.
func EnsureReadAccess(root string) error {
	marker := filepath.Join(root, accessMarker)
	if _, err := os.Stat(marker); err == nil {
		return nil
	}
	for _, sid := range []string{"*S-1-15-2-2:(OI)(CI)(RX)", "*S-1-15-2-1:(OI)(CI)(RX)"} {
		command := exec.Command("icacls.exe", root, "/grant", sid, "/C", "/Q")
		output, err := command.CombinedOutput()
		if err != nil {
			return fmt.Errorf("grant WebView2 read access (%s): %w: %s", sid, err, strings.TrimSpace(string(output)))
		}
	}
	return os.WriteFile(marker, []byte("ok\n"), 0o600)
}
