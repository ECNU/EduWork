package updatecontrol

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

type Edition struct {
	Provider            string `json:"provider,omitempty"`
	GitHubRepository    string `json:"repository,omitempty"`
	Distribution        string `json:"distribution,omitempty"`
	SchemaVersion       int    `json:"schemaVersion"`
	Enabled             *bool  `json:"enabled,omitempty"`
	ManifestBaseURL     string `json:"manifestBaseURL"`
	DefaultPolicy       string `json:"defaultPolicy"`
	Target              string `json:"target"`
	Flavor              string `json:"flavor"`
	AllowShellMigration bool   `json:"allowShellMigration,omitempty"`
}

type Config struct {
	Version          string
	DefaultPolicy    string
	EditionPath      string
	StateDir         string
	InstallDir       string
	ExecutableName   string
	UpdateHealthFile string
	RequestExit      func()
	LaunchHelper     func() error
	RequiredShell    string
}

type Snapshot struct {
	Enabled            bool   `json:"enabled"`
	State              string `json:"state"`
	Policy             string `json:"policy"`
	CurrentVersion     string `json:"currentVersion"`
	LatestVersion      string `json:"latestVersion,omitempty"`
	Channel            string `json:"channel,omitempty"`
	CheckedAt          string `json:"checkedAt,omitempty"`
	PublishedAt        string `json:"publishedAt,omitempty"`
	FileName           string `json:"fileName,omitempty"`
	DownloadedBytes    int64  `json:"downloadedBytes"`
	TotalBytes         int64  `json:"totalBytes"`
	InstallOnNextStart bool   `json:"installOnNextStart"`
	RelaunchedVersion  string `json:"relaunchedVersion,omitempty"`
	Error              string `json:"error,omitempty"`
}

type preferences struct {
	SchemaVersion int    `json:"schemaVersion"`
	Policy        string `json:"policy"`
	Source        string `json:"source,omitempty"`
}

type Manager struct {
	mu                 sync.Mutex
	config             Config
	edition            Edition
	policy             string
	status             updater.Status
	download           updater.DownloadStatus
	state              string
	lastErr            string
	installOnNextStart bool
	relaunchedVersion  string
}

func New(config Config) (*Manager, error) {
	payload, err := os.ReadFile(config.EditionPath)
	if err != nil {
		return nil, err
	}
	var edition Edition
	if err := json.Unmarshal(payload, &edition); err != nil {
		return nil, err
	}
	// The application manifest is replaced on upgrade; config/ is preserved.
	// Use the new assembly default instead of a stale copied bridge default.
	if config.DefaultPolicy != "" {
		edition.DefaultPolicy = config.DefaultPolicy
	}
	if edition.SchemaVersion != 1 || !validPolicy(edition.DefaultPolicy) || strings.TrimSpace(edition.Target) == "" || strings.TrimSpace(edition.Flavor) == "" {
		return nil, errors.New("update edition is incomplete")
	}
	if edition.enabled() && edition.Provider != "github" && strings.TrimSpace(edition.ManifestBaseURL) == "" {
		return nil, errors.New("enabled update edition requires manifestBaseURL")
	}
	initialState := "idle"
	if !edition.enabled() {
		initialState = "disabled"
	}
	manager := &Manager{
		config: config, edition: edition, policy: edition.DefaultPolicy, state: initialState,
		relaunchedVersion: relaunchedVersion(config.UpdateHealthFile),
	}
	if saved, err := manager.readPreferences(); err == nil && saved.SchemaVersion == 1 && validPolicy(saved.Policy) {
		manager.policy = saved.Policy
	} else if os.IsNotExist(err) {
		// Keep the originating channel across later Go/Electron upgrades, even
		// when the next package has a different fresh-install default.
		if err := manager.writePreferences("packaged-default"); err != nil {
			return nil, err
		}
	}
	_ = updater.DiscardSupersededPending(config.StateDir, config.Version)
	if pending, err := updater.LoadPending(config.StateDir); err == nil && pending.Version != config.Version {
		manager.state = pending.State
		manager.status.LatestVersion = pending.Version
		manager.status.Channel = pending.Channel
		manager.installOnNextStart = pending.InstallOnNextStart
		manager.download = updater.DownloadStatus{
			State: pending.State, Version: pending.Version, FileName: filepath.Base(pending.ZIPPath),
		}
		if pending.State == "error" {
			manager.lastErr = pending.Error
		}
	}
	if manager.relaunchedVersion != "" && edition.enabled() {
		manager.state = "installed"
	}
	return manager, nil
}

func (manager *Manager) Status() Snapshot {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.snapshotLocked()
}

func (manager *Manager) SetPolicy(policy string) (Snapshot, error) {
	if !validPolicy(policy) {
		return Snapshot{}, errors.New("update policy must be stable or development")
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.state == "checking" || manager.state == "downloading" || manager.state == "ready" || manager.state == "applying" {
		return manager.snapshotLocked(), errors.New("请在当前更新处理完成后切换更新渠道")
	}
	previous := manager.policy
	manager.policy = policy
	if err := manager.writePreferencesLocked(); err != nil {
		manager.policy = previous
		return Snapshot{}, err
	}
	manager.status = updater.Status{}
	manager.download = updater.DownloadStatus{}
	if !manager.edition.enabled() {
		manager.state = "disabled"
	} else if manager.state != "ready" && manager.state != "applying" && manager.state != "installed" {
		manager.state = "idle"
	}
	manager.lastErr = ""
	return manager.snapshotLocked(), nil
}

func (manager *Manager) Check(ctx context.Context) (Snapshot, error) {
	manager.mu.Lock()
	if !manager.edition.enabled() {
		manager.state = "disabled"
		snapshot := manager.snapshotLocked()
		manager.mu.Unlock()
		return snapshot, errors.New("automatic updates are not configured for this distribution")
	}
	if manager.state == "ready" || manager.state == "applying" || manager.state == "downloading" || manager.state == "checking" {
		snapshot := manager.snapshotLocked()
		manager.mu.Unlock()
		return snapshot, nil
	}
	policy := manager.policy
	manager.state = "checking"
	manager.lastErr = ""
	manager.mu.Unlock()
	channels := []string{"stable"}
	if policy == "development" {
		channels = append(channels, "development")
	}
	status, err := updater.CheckBest(ctx, updater.Config{
		Provider:            manager.edition.Provider,
		GitHubRepository:    manager.edition.GitHubRepository,
		Distribution:        manager.edition.Distribution,
		CacheDir:            manager.config.StateDir,
		ManifestBaseURL:     manager.edition.ManifestBaseURL,
		CurrentVersion:      manager.config.Version,
		Target:              manager.edition.Target,
		Flavor:              manager.edition.Flavor,
		AllowShellMigration: manager.edition.AllowShellMigration,
	}, channels)
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if err == nil && manager.config.RequiredShell != "" && status.Artifact.Shell != manager.config.RequiredShell {
		err = errors.New("the update package does not match the installed desktop shell")
	}
	if err != nil {
		manager.state = "error"
		manager.lastErr = err.Error()
		return manager.snapshotLocked(), err
	}
	manager.status = status
	manager.state = status.State
	return manager.snapshotLocked(), nil
}

func (manager *Manager) Download(ctx context.Context) (Snapshot, error) {
	manager.mu.Lock()
	status := manager.status
	if manager.state != "available" {
		manager.mu.Unlock()
		return Snapshot{}, errors.New("no update is available")
	}
	manager.state = "downloading"
	manager.lastErr = ""
	manager.download = updater.DownloadStatus{State: "downloading", Version: status.LatestVersion, TotalBytes: status.Artifact.Bytes, FileName: status.Artifact.FileName}
	manager.mu.Unlock()
	result, err := updater.Download(ctx, updater.DownloadConfig{
		Provider:            manager.edition.Provider,
		GitHubRepository:    manager.edition.GitHubRepository,
		Distribution:        manager.edition.Distribution,
		ManifestBaseURL:     manager.edition.ManifestBaseURL,
		Channel:             status.Channel,
		Version:             status.LatestVersion,
		StateDir:            manager.config.StateDir,
		InstallDir:          manager.config.InstallDir,
		ExecutableName:      manager.config.ExecutableName,
		Artifact:            status.Artifact,
		AllowShellMigration: manager.edition.AllowShellMigration,
		Progress: func(progress updater.DownloadStatus) {
			manager.mu.Lock()
			manager.download = progress
			manager.mu.Unlock()
		},
	})
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if err != nil {
		manager.state = "error"
		manager.lastErr = err.Error()
		return manager.snapshotLocked(), err
	}
	manager.download = result
	manager.state = "ready"
	manager.installOnNextStart = false
	return manager.snapshotLocked(), nil
}

// ScheduleNextStart arms an already verified package without stopping the
// current Agent task. The launcher applies it before the next normal startup.
func (manager *Manager) ScheduleNextStart() (Snapshot, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.state != "ready" {
		return Snapshot{}, errors.New("no verified update is ready")
	}
	if _, err := updater.MarkInstallOnNextStart(manager.config.StateDir, true); err != nil {
		return Snapshot{}, err
	}
	manager.installOnNextStart = true
	return manager.snapshotLocked(), nil
}

// InstallNow starts the detached updater helper, then asks the desktop shell
// to close. The helper waits for this process to release the Windows files,
// installs the complete release tree and relaunches the new executable.
func (manager *Manager) InstallNow() (Snapshot, error) {
	manager.mu.Lock()
	if manager.state != "ready" {
		manager.mu.Unlock()
		return Snapshot{}, errors.New("no verified update is ready")
	}
	if manager.config.RequestExit == nil {
		manager.mu.Unlock()
		return Snapshot{}, errors.New("immediate update is unavailable in this host mode")
	}
	if _, err := updater.MarkInstallOnNextStart(manager.config.StateDir, false); err != nil {
		manager.mu.Unlock()
		return Snapshot{}, err
	}
	launch := manager.config.LaunchHelper
	if launch == nil {
		launch = func() error { return updater.LaunchPendingHelper(manager.config.StateDir) }
	}
	if err := launch(); err != nil {
		manager.mu.Unlock()
		return Snapshot{}, err
	}
	manager.state = "applying"
	manager.installOnNextStart = false
	snapshot := manager.snapshotLocked()
	requestExit := manager.config.RequestExit
	manager.mu.Unlock()
	go func() {
		time.Sleep(180 * time.Millisecond)
		requestExit()
	}()
	return snapshot, nil
}

func (manager *Manager) AutoCheck() {
	manager.mu.Lock()
	if !manager.edition.enabled() {
		manager.mu.Unlock()
		return
	}
	justRelaunched := manager.state == "installed"
	manager.mu.Unlock()
	if justRelaunched {
		// Keep the one-shot success receipt visible for this relaunched desktop.
		// The user can still request a fresh check explicitly; the next ordinary
		// cold start has no update-health argument and resumes normal auto-check.
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_, _ = manager.Check(ctx)
}

func (manager *Manager) snapshotLocked() Snapshot {
	return Snapshot{
		Enabled: manager.edition.enabled(),
		State:   manager.state, Policy: manager.policy, CurrentVersion: manager.config.Version,
		LatestVersion: manager.status.LatestVersion, Channel: manager.status.Channel,
		CheckedAt: manager.status.CheckedAt, PublishedAt: manager.status.PublishedAt,
		FileName: manager.download.FileName, DownloadedBytes: manager.download.DownloadedBytes,
		TotalBytes: manager.download.TotalBytes, InstallOnNextStart: manager.installOnNextStart,
		RelaunchedVersion: manager.relaunchedVersion, Error: manager.lastErr,
	}
}

// enabled keeps existing private edition files compatible: omitting the field
// means enabled, while the public generic edition explicitly sets false.
func (edition Edition) enabled() bool {
	return edition.Enabled == nil || *edition.Enabled
}

func validPolicy(policy string) bool { return policy == "stable" || policy == "development" }

func (manager *Manager) preferencesPath() string {
	return filepath.Join(manager.config.StateDir, "update-preferences.json")
}

func (manager *Manager) readPreferences() (preferences, error) {
	payload, err := os.ReadFile(manager.preferencesPath())
	if err != nil {
		return preferences{}, err
	}
	var value preferences
	err = json.Unmarshal(payload, &value)
	return value, err
}

func (manager *Manager) writePreferencesLocked() error {
	return manager.writePreferences("user")
}

func (manager *Manager) writePreferences(source string) error {
	if err := os.MkdirAll(manager.config.StateDir, 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(preferences{SchemaVersion: 1, Policy: manager.policy, Source: source}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(manager.preferencesPath(), append(payload, '\n'), 0o600)
}

func relaunchedVersion(healthFile string) string {
	clean := filepath.Clean(strings.TrimSpace(healthFile))
	if clean == "." || filepath.Base(clean) != "health.ok" {
		return ""
	}
	version := filepath.Base(filepath.Dir(clean))
	if version == "" || version == "." || version == string(filepath.Separator) {
		return ""
	}
	return version
}
