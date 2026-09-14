// Package updater shares verified download and installation across static
// HTTPS feeds and public GitHub Releases. Check only discovers metadata.
package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxManifestBytes = 1 << 20

var (
	channelPattern = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z._-]*$`)
	sha256Pattern  = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
	versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*))?(?:[+]([0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*))?$`)
	numericPattern = regexp.MustCompile(`^[0-9]+$`)
)

type Config struct {
	Provider            string
	GitHubRepository    string
	Distribution        string
	CacheDir            string
	ManifestBaseURL     string
	Channel             string
	CurrentVersion      string
	Target              string
	Flavor              string
	HTTPClient          *http.Client
	AllowShellMigration bool
}

type Artifact struct {
	Flavor    string `json:"flavor"`
	FileName  string `json:"fileName"`
	Bytes     int64  `json:"bytes"`
	SHA256    string `json:"sha256"`
	ObjectKey string `json:"objectKey"`
	URL       string `json:"url"`
	SHA256URL string `json:"sha256Url"`
	GitCommit string `json:"gitCommit"`
	Shell     string `json:"shell,omitempty"`
}

type Manifest struct {
	Distribution  string     `json:"distribution,omitempty"`
	SchemaVersion int        `json:"schemaVersion"`
	Channel       string     `json:"channel"`
	Version       string     `json:"version"`
	Target        string     `json:"target"`
	PublishedAt   string     `json:"publishedAt"`
	Artifacts     []Artifact `json:"artifacts"`
}

type Status struct {
	State          string   `json:"state"`
	CurrentVersion string   `json:"currentVersion"`
	LatestVersion  string   `json:"latestVersion,omitempty"`
	Channel        string   `json:"channel"`
	CheckedAt      string   `json:"checkedAt"`
	PublishedAt    string   `json:"publishedAt,omitempty"`
	Artifact       Artifact `json:"artifact"`
}

func Check(ctx context.Context, config Config) (Status, error) {
	if config.Provider == "github" {
		return checkGitHub(ctx, config)
	}
	if config.Provider != "" && config.Provider != "static" {
		return Status{}, errors.New("unsupported update provider")
	}
	base, err := validateConfig(config)
	if err != nil {
		return Status{}, err
	}
	manifestURL := strings.TrimRight(base.String(), "/") + "/" + url.PathEscape(config.Channel) + "/latest-" + url.PathEscape(config.Target) + ".json"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return Status{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-cache")
	request.Header.Set("User-Agent", "ChatECNU-Work-Updater/1")
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return Status{}, fmt.Errorf("read release manifest: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8<<10))
		return Status{}, fmt.Errorf("release manifest returned HTTP %d", response.StatusCode)
	}
	var manifest Manifest
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxManifestBytes+1))
	if err := decoder.Decode(&manifest); err != nil {
		return Status{}, fmt.Errorf("decode release manifest: %w", err)
	}
	if manifest.SchemaVersion != 1 || manifest.Channel != config.Channel || manifest.Target != config.Target {
		return Status{}, errors.New("release manifest identity does not match this edition")
	}
	parsed, err := parseVersion(manifest.Version)
	if err != nil {
		return Status{}, fmt.Errorf("invalid latest version: %w", err)
	}
	if config.Channel == "stable" && len(parsed.prerelease) > 0 {
		return Status{}, errors.New("公测更新渠道不能提供开发版本")
	}
	comparison, err := CompareVersions(manifest.Version, config.CurrentVersion)
	if err != nil {
		return Status{}, err
	}
	artifact, err := selectArtifact(base, config.Channel, manifest.Artifacts, config.Flavor)
	if err != nil {
		return Status{}, err
	}
	if artifact.Shell != "" && artifact.Shell != "wails" && artifact.Shell != "electron" {
		return Status{}, errors.New("unsupported update shell")
	}
	if artifact.Shell == "electron" && !config.AllowShellMigration {
		return Status{}, errors.New("this update requires the Go-to-Electron transition edition")
	}
	state := "up_to_date"
	if comparison > 0 {
		state = "available"
	}
	return Status{
		State: state, CurrentVersion: config.CurrentVersion, LatestVersion: manifest.Version,
		Channel: config.Channel, CheckedAt: time.Now().UTC().Format(time.RFC3339),
		PublishedAt: manifest.PublishedAt, Artifact: artifact,
	}, nil
}

// CheckBest evaluates every eligible channel and returns the newest version
// using SemVer precedence. A missing channel pointer does not hide a valid
// release from another eligible channel; only an all-channel failure is an
// error. Stable callers pass only "stable". Preview callers pass stable and
// development so opting into previews never makes a final release invisible.
func CheckBest(ctx context.Context, config Config, channels []string) (Status, error) {
	if len(channels) == 0 {
		return Status{}, errors.New("at least one update channel is required")
	}
	var best Status
	var failures []error
	for _, channel := range channels {
		candidate := config
		candidate.Channel = channel
		status, err := Check(ctx, candidate)
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", channel, err))
			continue
		}
		if best.LatestVersion == "" {
			best = status
			continue
		}
		comparison, err := CompareVersions(status.LatestVersion, best.LatestVersion)
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", channel, err))
			continue
		}
		if comparison > 0 {
			best = status
		}
	}
	if best.LatestVersion == "" {
		return Status{}, errors.Join(failures...)
	}
	comparison, err := CompareVersions(best.LatestVersion, config.CurrentVersion)
	if err != nil {
		return Status{}, err
	}
	if comparison > 0 {
		best.State = "available"
	} else {
		best.State = "up_to_date"
	}
	return best, nil
}

func ValidateArtifactURL(manifestBaseURL, channel, target string) error {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(manifestBaseURL), "/"))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil {
		return errors.New("update manifest base must be an absolute HTTPS URL")
	}
	return validateArtifactURL(base, channel, target)
}

func validateConfig(config Config) (*url.URL, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(config.ManifestBaseURL), "/"))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("update manifest base must be an absolute HTTPS URL without query or fragment")
	}
	if !channelPattern.MatchString(config.Channel) || strings.TrimSpace(config.Target) == "" || strings.TrimSpace(config.Flavor) == "" {
		return nil, errors.New("update channel, target and flavor are required")
	}
	if _, err := parseVersion(config.CurrentVersion); err != nil {
		return nil, fmt.Errorf("invalid current version: %w", err)
	}
	return base, nil
}

func selectArtifact(base *url.URL, channel string, artifacts []Artifact, flavor string) (Artifact, error) {
	for _, artifact := range artifacts {
		if strings.EqualFold(strings.TrimSpace(artifact.Flavor), strings.TrimSpace(flavor)) {
			artifact.SHA256 = strings.ToLower(strings.TrimSpace(artifact.SHA256))
			if artifact.Bytes <= 0 || !sha256Pattern.MatchString(artifact.SHA256) || strings.TrimSpace(artifact.FileName) == "" {
				return Artifact{}, errors.New("release artifact metadata is incomplete")
			}
			if err := validateArtifactURL(base, channel, artifact.URL); err != nil {
				return Artifact{}, err
			}
			if strings.TrimSpace(artifact.SHA256URL) == "" {
				artifact.SHA256URL = strings.TrimSpace(artifact.URL) + ".sha256"
			}
			if err := validateArtifactURL(base, channel, artifact.SHA256URL); err != nil {
				return Artifact{}, fmt.Errorf("invalid SHA-256 sidecar URL: %w", err)
			}
			return artifact, nil
		}
	}
	return Artifact{}, fmt.Errorf("release manifest has no %s artifact", flavor)
}

func validateArtifactURL(base *url.URL, channel, target string) error {
	artifact, err := url.Parse(strings.TrimSpace(target))
	if err != nil || artifact.Scheme != "https" || artifact.Host == "" || artifact.User != nil || artifact.RawQuery != "" || artifact.Fragment != "" {
		return errors.New("release artifact URL must be an absolute HTTPS URL without credentials, query or fragment")
	}
	basePath := strings.TrimRight(base.EscapedPath(), "/") + "/" + url.PathEscape(channel) + "/"
	if !strings.EqualFold(base.Scheme, artifact.Scheme) || !strings.EqualFold(base.Host, artifact.Host) || !strings.HasPrefix(artifact.EscapedPath(), basePath) {
		return errors.New("release artifact URL is outside the trusted edition release prefix")
	}
	return nil
}

type parsedVersion struct {
	core       [3]uint64
	prerelease []string
}

func parseVersion(value string) (parsedVersion, error) {
	match := versionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return parsedVersion{}, fmt.Errorf("unsupported version %q", value)
	}
	var result parsedVersion
	for index := 0; index < 3; index++ {
		number, err := strconv.ParseUint(match[index+1], 10, 64)
		if err != nil {
			return parsedVersion{}, err
		}
		result.core[index] = number
	}
	if match[4] != "" {
		result.prerelease = strings.Split(match[4], ".")
		for _, identifier := range result.prerelease {
			if numericPattern.MatchString(identifier) && len(identifier) > 1 && identifier[0] == '0' {
				return parsedVersion{}, fmt.Errorf("numeric prerelease identifier %q has a leading zero", identifier)
			}
		}
	}
	return result, nil
}

// CompareVersions returns -1, 0 or 1 using SemVer precedence. Build metadata
// is ignored, exactly as required for release update decisions.
func CompareVersions(left, right string) (int, error) {
	a, err := parseVersion(left)
	if err != nil {
		return 0, err
	}
	b, err := parseVersion(right)
	if err != nil {
		return 0, err
	}
	for index := range a.core {
		if a.core[index] < b.core[index] {
			return -1, nil
		}
		if a.core[index] > b.core[index] {
			return 1, nil
		}
	}
	if len(a.prerelease) == 0 && len(b.prerelease) == 0 {
		return 0, nil
	}
	if len(a.prerelease) == 0 {
		return 1, nil
	}
	if len(b.prerelease) == 0 {
		return -1, nil
	}
	limit := min(len(a.prerelease), len(b.prerelease))
	for index := 0; index < limit; index++ {
		leftPart, rightPart := a.prerelease[index], b.prerelease[index]
		leftNumber, leftErr := strconv.ParseUint(leftPart, 10, 64)
		rightNumber, rightErr := strconv.ParseUint(rightPart, 10, 64)
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNumber < rightNumber {
				return -1, nil
			}
			if leftNumber > rightNumber {
				return 1, nil
			}
		case leftErr == nil:
			return -1, nil
		case rightErr == nil:
			return 1, nil
		default:
			if leftPart < rightPart {
				return -1, nil
			}
			if leftPart > rightPart {
				return 1, nil
			}
		}
	}
	if len(a.prerelease) < len(b.prerelease) {
		return -1, nil
	}
	if len(a.prerelease) > len(b.prerelease) {
		return 1, nil
	}
	return 0, nil
}
