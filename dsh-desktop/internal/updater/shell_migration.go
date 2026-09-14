package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// These fields are inside the hash-verified release, not arbitrary command
// arguments supplied by a download URL. Old clients must stay on the legacy
// feed; only the bridge edition opts into the separate migration feed.
type releaseLaunch struct {
	Protocol     string `json:"protocol"`
	Shell        string `json:"shell"`
	Executable   string `json:"executable"`
	Migration    string `json:"migration"`
	Distribution string `json:"distribution"`
}

func validateReleaseLaunch(p PendingUpdate, m releaseManifest) error {
	if m.Launch == nil {
		if p.TargetShell == "electron" {
			return errors.New("Electron release is missing its migration launch contract")
		}
		return nil
	}
	l := m.Launch
	if !p.AllowShellMigration || p.TargetShell != "electron" || l.Protocol != "eduwork-desktop/v1" || l.Shell != "electron" || (l.Migration != "legacy-wails-v1" && l.Migration != "wails-host-v1") {
		return errors.New("release shell migration is not authorized or supported")
	}
	if l.Executable != "EduWork-Electron.exe" || !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`).MatchString(l.Distribution) {
		return errors.New("invalid Electron migration identity")
	}
	required := map[string]bool{l.Executable: false, "resources/app/eduwork.desktop.json": false}
	for _, f := range m.Files {
		if _, ok := required[f.Path]; ok {
			required[f.Path] = true
		}
	}
	for name, found := range required {
		if !found {
			return fmt.Errorf("migration payload is missing %s", name)
		}
	}
	return nil
}

func prepareReleaseLaunch(stateDir, transactionDir string, p PendingUpdate, m releaseManifest) (string, []string, error) {
	if err := validateReleaseLaunch(p, m); err != nil {
		return "", nil, err
	}
	if m.Launch == nil {
		return p.ExecutableName, append([]string(nil), p.RestartArgs...), nil
	}
	// An Electron update keeps its existing data home. The same ZIP also carries
	// a Wails migration contract so old bridge users can enter this release.
	var current struct {
		Shell        string `json:"shell"`
		Distribution string `json:"distribution"`
	}
	if bytes, err := os.ReadFile(filepath.Join(p.InstallDir, "resources/app/eduwork.desktop.json")); err == nil {
		if json.Unmarshal(bytes, &current) != nil || current.Shell != "electron" || current.Distribution != m.Launch.Distribution {
			return "", nil, errors.New("Electron update edition mismatch")
		}
		return m.Launch.Executable, nil, nil
	}
	// The old launcher owns data/state; custom data roots outside the install
	// need a separate explicit import, never an inferred filesystem traversal.
	if !strings.EqualFold(filepath.Clean(stateDir), filepath.Join(p.InstallDir, "data", "state")) {
		return "", nil, errors.New("automatic shell migration requires the legacy data/dsh layout; import the custom data directory separately")
	}
	sourceHome := filepath.Join(p.InstallDir, "data", "dsh")
	if m.Launch.Migration == "wails-host-v1" {
		var installed struct {
			Shell        string `json:"shell"`
			Distribution string `json:"distribution"`
		}
		bytes, err := os.ReadFile(filepath.Join(p.InstallDir, "eduwork.desktop.json"))
		if err != nil || json.Unmarshal(bytes, &installed) != nil || installed.Shell != "wails" || installed.Distribution != m.Launch.Distribution {
			return "", nil, errors.New("migration release does not match the installed Wails edition")
		}
		sourceHome = filepath.Join(p.InstallDir, "data", installed.Distribution+"-wails", "dsh")
	} else if _, err := os.Stat(filepath.Join(p.InstallDir, "eduwork.desktop.json")); err == nil {
		return "", nil, errors.New("this Wails bridge requires a wails-host-v1 migration release; refusing stale legacy data")
	}
	for _, root := range []string{p.InstallDir, filepath.Join(p.InstallDir, "data"), sourceHome} {
		info, err := os.Lstat(root)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", nil, errors.New("legacy data directory is missing or linked")
		}
	}
	handoff := struct {
		SchemaVersion int    `json:"schemaVersion"`
		Kind          string `json:"kind"`
		Version       string `json:"version"`
		Distribution  string `json:"distribution"`
		SourceHome    string `json:"sourceHome"`
	}{1, m.Launch.Migration, p.Version, m.Launch.Distribution, sourceHome}
	bytes, err := json.MarshalIndent(handoff, "", "  ")
	if err != nil {
		return "", nil, err
	}
	path := filepath.Join(transactionDir, "migration.json")
	if err = os.WriteFile(path, append(bytes, '\n'), 0600); err != nil {
		return "", nil, err
	}
	return m.Launch.Executable, []string{"--eduwork-migration", path}, nil
}
