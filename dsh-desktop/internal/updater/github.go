package updater

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var githubRepositoryPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

const githubManifestName = "update-windows-amd64.json"

var githubDevelopmentVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)-dev[.][0-9]{8}[.][1-9][0-9]*$`)

type githubAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
	State  string `json:"state"`
}
type githubRelease struct {
	Tag         string        `json:"tag_name"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	PublishedAt string        `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

func githubPackageName(distribution string) (string, error) {
	switch distribution {
	case "eduwork":
		return "EduWork", nil
	case "eduwork-chatecnu":
		return "EduWork-ECNU", nil
	default:
		return "", errors.New("unsupported GitHub update distribution")
	}
}

func githubAssetURL(repository, version, name string) string {
	return "https://github.com/" + repository + "/releases/download/v" + version + "/" + name
}

func matchesGitHubAssetURL(raw, repository, version, name string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.EscapedPath() != u.Path {
		return false
	}
	parts := strings.SplitN(strings.TrimPrefix(u.Path, "/"), "/", 3)
	return len(parts) == 3 && strings.EqualFold(parts[0]+"/"+parts[1], repository) && parts[2] == "releases/download/v"+version+"/"+name
}

func validateGitHubArtifact(repository, distribution, version string, artifact Artifact) error {
	name, err := githubPackageName(distribution)
	if err != nil {
		return err
	}
	v, err := parseVersion(version)
	if !githubRepositoryPattern.MatchString(repository) || err != nil || (len(v.prerelease) != 0 && !githubDevelopmentVersionPattern.MatchString(version)) || strings.Contains(version, "+") {
		return errors.New("invalid GitHub repository or product version")
	}
	expected := name + "-" + version + "-windows-x64-electron.zip"
	if artifact.FileName != expected || artifact.Shell != "electron" || artifact.Flavor != "offline" || artifact.Bytes < 1 || artifact.Bytes >= 2<<30 || !sha256Pattern.MatchString(artifact.SHA256) {
		return errors.New("GitHub update artifact identity or checksum is invalid")
	}
	if !matchesGitHubAssetURL(artifact.URL, repository, version, expected) || artifact.SHA256URL != artifact.URL+".sha256" {
		return errors.New("GitHub update asset is outside the configured repository/tag")
	}
	return nil
}

// Only public, anonymous requests are used. Signed asset redirects are allowed
// on GitHub's download hosts, but no credentials/cookies follow those redirects.
func githubHTTPClient(original *http.Client, repository, version string) *http.Client {
	client := http.Client{Timeout: 15 * time.Second}
	if original != nil {
		client = *original
	}
	client.Jar = nil
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 6 {
			return errors.New("too many GitHub download redirects")
		}
		u := req.URL
		if u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
			return errors.New("unsafe GitHub download redirect")
		}
		switch u.Hostname() {
		case "github.com":
			if !matchesGitHubAssetURL(u.String(), repository, version, filepath.Base(u.Path)) {
				return errors.New("GitHub download redirected outside the release")
			}
		case "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		default:
			return errors.New("untrusted GitHub download redirect host")
		}
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		req.Header.Del("Proxy-Authorization")
		return nil
	}
	return &client
}

type githubCache struct {
	Until   time.Time       `json:"until"`
	ETag    string          `json:"etag,omitempty"`
	Body    json.RawMessage `json:"body,omitempty"`
	Failure string          `json:"failure,omitempty"`
}

func readGitHubJSON(ctx context.Context, client *http.Client, target, cacheDir string) ([]byte, error) {
	var saved githubCache
	cachePath := ""
	if cacheDir != "" {
		cachePath = filepath.Join(cacheDir, "github-cache", fmt.Sprintf("%x.json", sha256.Sum256([]byte(target))))
		if bytes, err := os.ReadFile(cachePath); err == nil && len(bytes) <= maxManifestBytes+4096 {
			_ = json.Unmarshal(bytes, &saved)
		}
		if time.Now().Before(saved.Until) && time.Until(saved.Until) <= 15*time.Minute {
			if saved.Failure != "" {
				return nil, errors.New(saved.Failure)
			}
			if len(saved.Body) > 0 {
				return saved.Body, nil
			}
		}
	}
	save := func(entry githubCache) {
		if cachePath == "" {
			return
		}
		bytes, err := json.Marshal(entry)
		if err != nil || os.MkdirAll(filepath.Dir(cachePath), 0700) != nil {
			return
		}
		file, err := os.CreateTemp(filepath.Dir(cachePath), "cache-*.json")
		if err != nil {
			return
		}
		defer os.Remove(file.Name())
		_, err = file.Write(bytes)
		closeErr := file.Close()
		if err == nil && closeErr == nil {
			_ = os.Rename(file.Name(), cachePath)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "EduWork-Updater/1")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if saved.ETag != "" && len(saved.Body) > 0 {
		req.Header.Set("If-None-Match", saved.ETag)
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接 GitHub 更新源失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotModified && len(saved.Body) > 0 {
		saved.Until = time.Now().Add(15 * time.Minute)
		save(saved)
		return saved.Body, nil
	}
	if response.StatusCode != http.StatusOK {
		message := fmt.Sprintf("GitHub 更新源返回 HTTP %d，请稍后重试", response.StatusCode)
		if response.StatusCode == 404 {
			message = "尚无可读取的 GitHub 版本（仓库未公开、版本为草稿或文件未发布）"
		}
		if response.StatusCode == 403 || response.StatusCode == 429 {
			message = "GitHub 暂时限制更新请求，请在 15 分钟后重试"
		}
		save(githubCache{Until: time.Now().Add(15 * time.Minute), Failure: message})
		return nil, errors.New(message)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxManifestBytes || !json.Valid(body) {
		return nil, errors.New("invalid or oversized GitHub update metadata")
	}
	save(githubCache{Until: time.Now().Add(15 * time.Minute), ETag: response.Header.Get("ETag"), Body: body})
	return body, nil
}

func discoverGitHubRelease(ctx context.Context, config Config, client *http.Client) (githubRelease, error) {
	base := "https://api.github.com/repos/" + config.GitHubRepository + "/releases"
	if config.Channel == "stable" || config.Channel == "" {
		body, err := readGitHubJSON(ctx, client, base+"/latest", config.CacheDir)
		if err != nil {
			return githubRelease{}, err
		}
		var release githubRelease
		err = json.Unmarshal(body, &release)
		return release, err
	}
	if config.Channel != "development" {
		return githubRelease{}, errors.New("unsupported GitHub update channel")
	}
	// Select by SemVer, not GitHub's publication order. Stop with an error if
	// the bounded scan is incomplete, rather than silently choosing an old build.
	var best githubRelease
	for page := 1; page <= 10; page++ {
		body, err := readGitHubJSON(ctx, client, fmt.Sprintf("%s?per_page=20&page=%d", base, page), config.CacheDir)
		if err != nil {
			return githubRelease{}, err
		}
		var releases []githubRelease
		if err := json.Unmarshal(body, &releases); err != nil {
			return githubRelease{}, err
		}
		for _, release := range releases {
			version := strings.TrimPrefix(release.Tag, "v")
			if release.Draft || !release.Prerelease || release.PublishedAt == "" || release.Tag != "v"+version || !githubDevelopmentVersionPattern.MatchString(version) {
				continue
			}
			if best.Tag == "" {
				best = release
				continue
			}
			if comparison, err := CompareVersions(version, strings.TrimPrefix(best.Tag, "v")); err == nil && comparison > 0 {
				best = release
			}
		}
		if len(releases) < 20 {
			if best.Tag == "" {
				return githubRelease{}, errors.New("尚无已发布的 GitHub 开发版")
			}
			return best, nil
		}
	}
	return githubRelease{}, errors.New("GitHub 版本列表过长，请发行方归档旧开发版")
}

func checkGitHub(ctx context.Context, config Config) (Status, error) {
	if !githubRepositoryPattern.MatchString(config.GitHubRepository) || config.Target != "windows-amd64" || config.Flavor != "offline" || !config.AllowShellMigration {
		return Status{}, errors.New("GitHub updates require a configured Windows x64 Electron edition")
	}
	if _, err := githubPackageName(config.Distribution); err != nil {
		return Status{}, err
	}
	client := githubHTTPClient(config.HTTPClient, config.GitHubRepository, "")
	release, err := discoverGitHubRelease(ctx, config, client)
	if err != nil {
		return Status{}, err
	}
	version := strings.TrimPrefix(release.Tag, "v")
	v, err := parseVersion(version)
	channel := "stable"
	if config.Channel == "development" {
		channel = "development"
	}
	development := channel == "development"
	if err != nil || release.Tag != "v"+version || release.Draft || release.PublishedAt == "" || strings.Contains(version, "+") || release.Prerelease != development || (development && !githubDevelopmentVersionPattern.MatchString(version)) || (!development && len(v.prerelease) != 0) {
		return Status{}, errors.New("GitHub release does not match the requested product channel")
	}
	comparison, err := CompareVersions(version, config.CurrentVersion)
	if err != nil {
		return Status{}, err
	}
	assets := make(map[string]githubAsset)
	for _, asset := range release.Assets {
		if _, exists := assets[asset.Name]; exists {
			return Status{}, errors.New("duplicate GitHub release asset")
		}
		assets[asset.Name] = asset
	}
	meta, ok := assets[githubManifestName]
	if !ok || meta.State != "uploaded" || meta.Size <= 0 || meta.Size > maxManifestBytes || !matchesGitHubAssetURL(meta.URL, config.GitHubRepository, version, githubManifestName) {
		return Status{}, errors.New("GitHub 版本缺少可用的更新清单")
	}
	client = githubHTTPClient(config.HTTPClient, config.GitHubRepository, version)
	bytes, err := readGitHubJSON(ctx, client, meta.URL, config.CacheDir)
	if err != nil {
		return Status{}, err
	}
	if int64(len(bytes)) != meta.Size || meta.Digest != fmt.Sprintf("sha256:%x", sha256.Sum256(bytes)) {
		return Status{}, errors.New("GitHub update manifest digest differs")
	}
	var manifest Manifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return Status{}, err
	}
	if manifest.SchemaVersion != 1 || manifest.Distribution != config.Distribution || manifest.Version != version || manifest.Channel != channel || manifest.Target != config.Target || len(manifest.Artifacts) != 1 {
		return Status{}, errors.New("GitHub update manifest does not match this product/version/platform")
	}
	artifact := manifest.Artifacts[0]
	if err := validateGitHubArtifact(config.GitHubRepository, config.Distribution, version, artifact); err != nil {
		return Status{}, err
	}
	zipAsset, zipOK := assets[artifact.FileName]
	sidecar, sideOK := assets[artifact.FileName+".sha256"]
	if !zipOK || !sideOK || zipAsset.State != "uploaded" || sidecar.State != "uploaded" || !matchesGitHubAssetURL(zipAsset.URL, config.GitHubRepository, version, artifact.FileName) || !matchesGitHubAssetURL(sidecar.URL, config.GitHubRepository, version, artifact.FileName+".sha256") || zipAsset.Size != artifact.Bytes || zipAsset.Digest != "sha256:"+artifact.SHA256 || sidecar.Size <= 0 || sidecar.Size > maxSidecarBytes {
		return Status{}, errors.New("GitHub release assets differ from the update manifest")
	}
	state := "up_to_date"
	if comparison > 0 {
		state = "available"
	}
	return Status{State: state, CurrentVersion: config.CurrentVersion, LatestVersion: version, Channel: channel, CheckedAt: time.Now().UTC().Format(time.RFC3339), PublishedAt: release.PublishedAt, Artifact: artifact}, nil
}
