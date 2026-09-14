package updater

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	pendingSchemaVersion = 1
	maxSidecarBytes      = 4096
)

type DownloadConfig struct {
	Provider            string
	GitHubRepository    string
	Distribution        string
	ManifestBaseURL     string
	Channel             string
	Version             string
	StateDir            string
	InstallDir          string
	ExecutableName      string
	Artifact            Artifact
	HTTPClient          *http.Client
	Progress            func(DownloadStatus)
	AllowShellMigration bool
}

type DownloadStatus struct {
	State           string `json:"state"`
	Version         string `json:"version,omitempty"`
	FileName        string `json:"fileName,omitempty"`
	DownloadedBytes int64  `json:"downloadedBytes"`
	TotalBytes      int64  `json:"totalBytes"`
	Error           string `json:"error,omitempty"`
}

type PendingUpdate struct {
	SchemaVersion       int      `json:"schemaVersion"`
	Version             string   `json:"version"`
	Channel             string   `json:"channel"`
	Flavor              string   `json:"flavor"`
	ZIPPath             string   `json:"zipPath"`
	SHA256              string   `json:"sha256"`
	InstallDir          string   `json:"installDir"`
	ExecutableName      string   `json:"executableName"`
	RestartArgs         []string `json:"restartArgs"`
	State               string   `json:"state"`
	Error               string   `json:"error,omitempty"`
	InstallOnNextStart  bool     `json:"installOnNextStart"`
	CreatedAt           string   `json:"createdAt"`
	TargetShell         string   `json:"targetShell,omitempty"`
	AllowShellMigration bool     `json:"allowShellMigration,omitempty"`
}

func PendingFile(stateDir string) string {
	return filepath.Join(stateDir, "updates", "pending-update.json")
}

func Download(ctx context.Context, config DownloadConfig) (DownloadStatus, error) {
	if config.Artifact.Shell != "" && config.Artifact.Shell != "wails" && config.Artifact.Shell != "electron" {
		return DownloadStatus{}, errors.New("unsupported update shell")
	}
	if config.Artifact.Shell == "electron" && !config.AllowShellMigration {
		return DownloadStatus{}, errors.New("shell migration is not enabled in this edition")
	}
	if config.Provider == "github" {
		if err := validateGitHubArtifact(config.GitHubRepository, config.Distribution, config.Version, config.Artifact); err != nil {
			return DownloadStatus{}, err
		}
	} else {
		if config.Provider != "" && config.Provider != "static" {
			return DownloadStatus{}, errors.New("unsupported update provider")
		}
		base, err := url.Parse(strings.TrimRight(strings.TrimSpace(config.ManifestBaseURL), "/"))
		if err != nil || base.Scheme != "https" || base.Host == "" {
			return DownloadStatus{}, errors.New("update manifest base must be an absolute HTTPS URL")
		}
		if err := validateArtifactURL(base, config.Channel, config.Artifact.URL); err != nil {
			return DownloadStatus{}, err
		}
		if err := validateArtifactURL(base, config.Channel, config.Artifact.SHA256URL); err != nil {
			return DownloadStatus{}, err
		}
	}
	if _, err := parseVersion(config.Version); err != nil {
		return DownloadStatus{}, err
	}
	if config.Artifact.Bytes <= 0 || !sha256Pattern.MatchString(config.Artifact.SHA256) {
		return DownloadStatus{}, errors.New("release artifact metadata is incomplete")
	}
	if filepath.Base(config.Artifact.FileName) != config.Artifact.FileName || strings.TrimSpace(config.StateDir) == "" {
		return DownloadStatus{}, errors.New("release artifact filename or state directory is invalid")
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Minute}
	}
	if config.Provider == "github" {
		client = githubHTTPClient(client, config.GitHubRepository, config.Version)
	}
	expectedHash, err := readSidecar(ctx, client, config.Artifact.SHA256URL, config.Artifact.FileName)
	if err != nil {
		return DownloadStatus{}, err
	}
	manifestHash := strings.ToLower(strings.TrimSpace(config.Artifact.SHA256))
	if expectedHash != manifestHash {
		return DownloadStatus{}, errors.New("online SHA-256 sidecar does not match the release pointer")
	}
	downloadDir := filepath.Join(config.StateDir, "updates", "downloads", sanitizePathPart(config.Version))
	if err := os.MkdirAll(downloadDir, 0o700); err != nil {
		return DownloadStatus{}, fmt.Errorf("create update download directory: %w", err)
	}
	finalPath := filepath.Join(downloadDir, config.Artifact.FileName)
	tempPath := finalPath + ".part"
	status := DownloadStatus{State: "downloading", Version: config.Version, FileName: config.Artifact.FileName, TotalBytes: config.Artifact.Bytes}
	if fileMatches(finalPath, config.Artifact.Bytes, expectedHash) {
		status.DownloadedBytes = config.Artifact.Bytes
		emitDownload(config.Progress, status)
		return finishDownload(config, status, finalPath, expectedHash)
	}
	if err := removeInvalidFinal(finalPath); err != nil {
		return failDownload(config.Progress, status, err)
	}
	resumeOffset, err := resumableOffset(tempPath, config.Artifact.Bytes, expectedHash)
	if err != nil {
		return failDownload(config.Progress, status, err)
	}
	status.DownloadedBytes = resumeOffset
	emitDownload(config.Progress, status)
	if resumeOffset < config.Artifact.Bytes {
		startedFromPartial := resumeOffset > 0
		for attempt := 0; attempt < 2; attempt++ {
			if err := transferDownload(ctx, client, config, tempPath, &status); err != nil {
				// Keep the successfully written prefix. A later click or process
				// restart can continue from it with an HTTP Range request.
				return failDownload(config.Progress, status, err)
			}
			if status.DownloadedBytes != config.Artifact.Bytes {
				return failDownload(config.Progress, status, errors.New("release ZIP is truncated or larger than declared; the partial download was kept for retry"))
			}
			if verifyFileSHA256(tempPath, expectedHash) == nil {
				break
			}
			if !startedFromPartial || attempt > 0 {
				_ = os.Remove(tempPath)
				return failDownload(config.Progress, status, errors.New("release ZIP SHA-256 verification failed"))
			}
			// A stale or damaged prefix can produce a structurally complete
			// file after resuming. Retry once from byte zero automatically.
			if err := truncatePartial(tempPath); err != nil {
				return failDownload(config.Progress, status, err)
			}
			status.DownloadedBytes = 0
			startedFromPartial = false
			emitDownload(config.Progress, status)
		}
	}
	if err := activateVerifiedDownload(tempPath, finalPath); err != nil {
		return failDownload(config.Progress, status, err)
	}
	return finishDownload(config, status, finalPath, expectedHash)
}

func transferDownload(ctx context.Context, client *http.Client, config DownloadConfig, tempPath string, status *DownloadStatus) error {
	response, offset, err := openArtifactResponse(ctx, client, config, status.DownloadedBytes)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	flags := os.O_WRONLY | os.O_CREATE
	file, err := os.OpenFile(tempPath, flags, 0o600)
	if err != nil {
		return fmt.Errorf("open partial update download: %w", err)
	}
	if offset == 0 {
		if err := file.Truncate(0); err != nil {
			_ = file.Close()
			return fmt.Errorf("reset partial update download: %w", err)
		}
	} else if info, statErr := file.Stat(); statErr != nil || info.Size() != offset {
		_ = file.Close()
		if statErr != nil {
			return fmt.Errorf("inspect partial update download: %w", statErr)
		}
		return errors.New("partial update download changed while resuming")
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		_ = file.Close()
		return fmt.Errorf("seek partial update download: %w", err)
	}
	status.DownloadedBytes = offset
	emitDownload(config.Progress, *status)

	reader := io.LimitReader(response.Body, config.Artifact.Bytes-offset+1)
	buffer := make([]byte, 256<<10)
	lastEmit := time.Time{}
	for {
		count, readErr := reader.Read(buffer)
		if count > 0 {
			if _, err := file.Write(buffer[:count]); err != nil {
				_ = file.Close()
				return fmt.Errorf("write partial update download: %w", err)
			}
			status.DownloadedBytes += int64(count)
			if time.Since(lastEmit) >= 100*time.Millisecond || status.DownloadedBytes == status.TotalBytes {
				emitDownload(config.Progress, *status)
				lastEmit = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = file.Sync()
			_ = file.Close()
			return fmt.Errorf("read update download: %w", readErr)
		}
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("persist partial update download: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close partial update download: %w", err)
	}
	return nil
}

func openArtifactResponse(ctx context.Context, client *http.Client, config DownloadConfig, offset int64) (*http.Response, int64, error) {
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, config.Artifact.URL, nil)
		if err != nil {
			return nil, offset, err
		}
		request.Header.Set("Accept", "application/zip")
		request.Header.Set("Cache-Control", "no-cache")
		request.Header.Set("User-Agent", "ChatECNU-Work-Updater/1")
		if offset > 0 {
			request.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, offset, fmt.Errorf("download update: %w", err)
		}
		if offset > 0 && response.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8<<10))
			_ = response.Body.Close()
			offset = 0
			continue
		}
		if offset > 0 && response.StatusCode == http.StatusOK {
			// The origin ignored Range. Reuse this full response and safely
			// replace the partial file instead of appending duplicate bytes.
			offset = 0
		}
		if offset == 0 {
			if response.StatusCode != http.StatusOK {
				_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8<<10))
				_ = response.Body.Close()
				return nil, offset, fmt.Errorf("download update returned HTTP %d", response.StatusCode)
			}
			if response.ContentLength > 0 && response.ContentLength != config.Artifact.Bytes {
				_ = response.Body.Close()
				return nil, offset, errors.New("release ZIP size differs from the release pointer")
			}
			return response, offset, nil
		}
		if response.StatusCode != http.StatusPartialContent {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8<<10))
			_ = response.Body.Close()
			return nil, offset, fmt.Errorf("resume update download returned HTTP %d", response.StatusCode)
		}
		start, end, total, err := parseContentRange(response.Header.Get("Content-Range"))
		if err != nil || start != offset || end != config.Artifact.Bytes-1 || total != config.Artifact.Bytes {
			_ = response.Body.Close()
			return nil, offset, errors.New("resume update download returned an invalid Content-Range")
		}
		if response.ContentLength > 0 && response.ContentLength != config.Artifact.Bytes-offset {
			_ = response.Body.Close()
			return nil, offset, errors.New("resumed ZIP size differs from the release pointer")
		}
		return response, offset, nil
	}
	return nil, offset, errors.New("update server rejected both the partial and full download")
}

func parseContentRange(value string) (int64, int64, int64, error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "bytes ") {
		return 0, 0, 0, errors.New("invalid Content-Range unit")
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes "), "/")
	if len(parts) != 2 {
		return 0, 0, 0, errors.New("invalid Content-Range")
	}
	bounds := strings.Split(parts[0], "-")
	if len(bounds) != 2 {
		return 0, 0, 0, errors.New("invalid Content-Range bounds")
	}
	start, startErr := strconv.ParseInt(bounds[0], 10, 64)
	end, endErr := strconv.ParseInt(bounds[1], 10, 64)
	total, totalErr := strconv.ParseInt(parts[1], 10, 64)
	if startErr != nil || endErr != nil || totalErr != nil || start < 0 || end < start || total <= end {
		return 0, 0, 0, errors.New("invalid Content-Range numbers")
	}
	return start, end, total, nil
}

func resumableOffset(tempPath string, expectedSize int64, expectedHash string) (int64, error) {
	info, err := os.Stat(tempPath)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("inspect partial update download: %w", err)
	}
	if !info.Mode().IsRegular() {
		return 0, errors.New("partial update download is not a regular file")
	}
	if info.Size() == expectedSize && verifyFileSHA256(tempPath, expectedHash) == nil {
		return expectedSize, nil
	}
	if info.Size() >= expectedSize {
		if err := truncatePartial(tempPath); err != nil {
			return 0, err
		}
		return 0, nil
	}
	return info.Size(), nil
}

func truncatePartial(path string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("reset partial update download: %w", err)
	}
	return file.Close()
}

func fileMatches(path string, expectedSize int64, expectedHash string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() == expectedSize && verifyFileSHA256(path, expectedHash) == nil
}

func removeInvalidFinal(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove invalid completed update download: %w", err)
	}
	return nil
}

func activateVerifiedDownload(tempPath, finalPath string) error {
	if err := os.Remove(finalPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("replace completed update download: %w", err)
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return fmt.Errorf("activate verified update download: %w", err)
	}
	return nil
}

func finishDownload(config DownloadConfig, status DownloadStatus, finalPath, expectedHash string) (DownloadStatus, error) {
	pending := PendingUpdate{
		SchemaVersion: pendingSchemaVersion, Version: config.Version, Channel: config.Channel,
		Flavor: config.Artifact.Flavor, ZIPPath: finalPath, SHA256: expectedHash,
		InstallDir: config.InstallDir, ExecutableName: config.ExecutableName,
		RestartArgs: []string{"run"}, State: "ready", CreatedAt: time.Now().UTC().Format(time.RFC3339),
		TargetShell: config.Artifact.Shell, AllowShellMigration: config.AllowShellMigration,
	}
	if err := SavePending(config.StateDir, pending); err != nil {
		return failDownload(config.Progress, status, err)
	}
	status.State = "ready"
	emitDownload(config.Progress, status)
	return status, nil
}

func readSidecar(ctx context.Context, client *http.Client, target, fileName string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "text/plain")
	request.Header.Set("Cache-Control", "no-cache")
	request.Header.Set("User-Agent", "ChatECNU-Work-Updater/1")
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("read online SHA-256 sidecar: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SHA-256 sidecar returned HTTP %d", response.StatusCode)
	}
	line, err := bufio.NewReader(io.LimitReader(response.Body, maxSidecarBytes+1)).ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) != 2 || !sha256Pattern.MatchString(fields[0]) || strings.TrimPrefix(fields[1], "*") != fileName {
		return "", errors.New("online SHA-256 sidecar has an invalid format or filename")
	}
	return strings.ToLower(fields[0]), nil
}

func LoadPending(stateDir string) (PendingUpdate, error) {
	data, err := os.ReadFile(PendingFile(stateDir))
	if err != nil {
		return PendingUpdate{}, err
	}
	var pending PendingUpdate
	if err := json.Unmarshal(data, &pending); err != nil {
		return PendingUpdate{}, err
	}
	if pending.SchemaVersion != pendingSchemaVersion || pending.State == "" || pending.Version == "" {
		return PendingUpdate{}, errors.New("pending update identity is invalid")
	}
	return pending, nil
}

func SavePending(stateDir string, pending PendingUpdate) error {
	path := PendingFile(stateDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(pending, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), "pending-*.json")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(append(data, '\n')); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func MarkInstallOnNextStart(stateDir string, enabled bool) (PendingUpdate, error) {
	pending, err := LoadPending(stateDir)
	if err != nil {
		return PendingUpdate{}, err
	}
	pending.InstallOnNextStart = enabled
	if err := SavePending(stateDir, pending); err != nil {
		return PendingUpdate{}, err
	}
	return pending, nil
}

func emitDownload(progress func(DownloadStatus), status DownloadStatus) {
	if progress != nil {
		progress(status)
	}
}

func failDownload(progress func(DownloadStatus), status DownloadStatus, err error) (DownloadStatus, error) {
	status.State = "error"
	status.Error = err.Error()
	emitDownload(progress, status)
	return status, err
}

func sanitizePathPart(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._-", char) {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('-')
		}
	}
	return builder.String()
}
