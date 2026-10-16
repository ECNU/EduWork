package updater

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/electronaccess"
)

// A full offline release currently contains more than 44,000 files because it
// carries the pinned DSH, Python and Node runtimes. Keep a bounded read, but
// leave enough room for the per-file identities of a genuinely portable build.
const maxReleaseManifestBytes = 32 << 20

type releaseFile struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type releaseManifest struct {
	SchemaVersion   int            `json:"schemaVersion"`
	LauncherVersion string         `json:"launcherVersion"`
	Flavor          string         `json:"flavor"`
	Files           []releaseFile  `json:"files"`
	Launch          *releaseLaunch `json:"launch,omitempty"`
}

// ApplyProgress describes a user-visible phase of the transactional updater.
// Percent is monotonic for a successful update and intentionally covers the
// complete apply/restart lifecycle, not the earlier network download.
type ApplyProgress struct {
	Stage   string `json:"stage"`
	Message string `json:"message"`
	Percent int    `json:"percent"`
}

type ApplyProgressFunc func(ApplyProgress)

func reportApply(progress ApplyProgressFunc, stage, message string, percent int) {
	if progress == nil {
		return
	}
	if percent < 0 {
		percent = 0
	} else if percent > 100 {
		percent = 100
	}
	progress(ApplyProgress{Stage: stage, Message: message, Percent: percent})
}

// LaunchPendingHelper copies the currently running launcher into its private
// state directory. The copy acts as a small updater process, so Windows can
// release and replace the real executable after the desktop process exits.
func LaunchPendingHelper(stateDir string) error {
	current, err := os.Executable()
	if err != nil {
		return err
	}
	return LaunchPendingHelperFor(stateDir, current, os.Getpid())
}

// An Electron parent owns the UI and process lifetime; its small updater
// service copies itself out of the installation and waits for that parent.
func LaunchPendingHelperFor(stateDir, current string, parentPID int) error {
	pending, err := LoadPending(stateDir)
	if err != nil {
		return err
	}
	if pending.State != "ready" && pending.State != "error" {
		return fmt.Errorf("pending update is not ready (state %s)", pending.State)
	}
	helperDir := filepath.Join(stateDir, "updates", "helper")
	if err := os.MkdirAll(helperDir, 0o700); err != nil {
		return err
	}
	helperName := "ecnu-agent-updater"
	if filepath.Ext(current) != "" {
		helperName += filepath.Ext(current)
	}
	helper := filepath.Join(helperDir, helperName)
	if err := copyFileReplace(current, helper, 0o700); err != nil {
		return fmt.Errorf("prepare update helper: %w", err)
	}
	pending.State = "applying"
	pending.Error = ""
	pending.InstallOnNextStart = false
	if err := SavePending(stateDir, pending); err != nil {
		return err
	}
	command := exec.Command(helper, "apply-update", "--pending", PendingFile(stateDir), "--pid", strconv.Itoa(parentPID))
	configureDetachedHelperCommand(command)
	if err := command.Start(); err != nil {
		pending.State = "ready"
		_ = SavePending(stateDir, pending)
		return fmt.Errorf("start update helper: %w", err)
	}
	return command.Process.Release()
}

func LaunchScheduledIfNeeded(stateDir string) (bool, error) {
	pending, err := LoadPending(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if pending.State != "ready" || !pending.InstallOnNextStart {
		return false, nil
	}
	return true, LaunchPendingHelper(stateDir)
}

// A manually installed newer build must never apply an older cached download.
// Leave active transactions alone; their installer still owns the receipt.
func DiscardSupersededPending(stateDir, currentVersion string) error {
	pending, err := LoadPending(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	comparison, err := CompareVersions(pending.Version, currentVersion)
	if err != nil {
		return err
	}
	if comparison <= 0 && (pending.State == "ready" || pending.State == "error") {
		return os.Remove(PendingFile(stateDir))
	}
	return nil
}

// ApplyPending validates both the outer ZIP hash and the per-file release
// manifest before touching the installation.
// A failed health handshake restores all launcher-managed files and restarts
// the previous build.
func ApplyPending(pendingPath string, parentPID int) error {
	return ApplyPendingWithProgress(pendingPath, parentPID, nil)
}

// ApplyPendingWithProgress runs the same transactional update while reporting
// coarse-grained, user-facing progress. Both "install now" and "install on
// next start" launch this entrypoint so their update behaviour stays identical.
func ApplyPendingWithProgress(pendingPath string, parentPID int, progress ApplyProgressFunc) error {
	reportApply(progress, "waiting", "正在等待当前版本安全退出", 3)
	pending, stateDir, err := loadPendingPath(pendingPath)
	if err != nil {
		return err
	}
	if err := waitForProcessExit(parentPID, 45*time.Second); err != nil {
		reportApply(progress, "failed", "无法开始更新，正在保留当前版本", 100)
		return recordApplyFailure(stateDir, pending, err)
	}
	oldExecutable := filepath.Join(pending.InstallDir, pending.ExecutableName)
	applyErr := applyAndRestart(stateDir, pending, progress)
	if applyErr == nil {
		reportApply(progress, "done", "更新完成，ChatECNU Work 已自动启动", 100)
		return nil
	}
	reportApply(progress, "failed", "更新未完成，正在恢复原版本", 100)
	_ = recordApplyFailure(stateDir, pending, applyErr)
	var recovery *rollbackFailure
	if errors.As(applyErr, &recovery) {
		return applyErr
	}
	if _, statErr := os.Stat(oldExecutable); statErr == nil {
		command := exec.Command(oldExecutable, pending.RestartArgs...)
		command.Dir = pending.InstallDir
		configureDetachedAppCommand(command)
		if err := command.Start(); err == nil {
			_ = command.Process.Release()
		}
	}
	return applyErr
}

func applyAndRestart(stateDir string, pending PendingUpdate, progress ApplyProgressFunc) error {
	reportApply(progress, "verify-package", "正在校验更新包", 7)
	if err := validatePendingPaths(stateDir, pending); err != nil {
		return err
	}
	sweepCommittedTransactions(stateDir)
	transactionDir := filepath.Join(stateDir, "updates", "transactions", sanitizePathPart(pending.Version))
	extractDir := filepath.Join(transactionDir, "extracted")
	backupDir := filepath.Join(transactionDir, "backup")
	// A previous interrupted/failed rollback may contain the only intact old
	// program. Never erase it when retrying this version.
	if entries, err := os.ReadDir(backupDir); err == nil && len(entries) > 0 {
		return &rollbackFailure{Cause: errors.New("previous update backup requires recovery before retry"), Backup: backupDir}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return &rollbackFailure{Cause: err, Backup: backupDir}
	}
	if err := verifyFileSHA256(pending.ZIPPath, pending.SHA256); err != nil {
		return fmt.Errorf("verify downloaded ZIP: %w", err)
	}
	if err := os.RemoveAll(transactionDir); err != nil {
		return fmt.Errorf("prepare update transaction: %w", err)
	}
	if err := os.MkdirAll(extractDir, 0o700); err != nil {
		return err
	}
	stage := extractAndVerifyReleaseWithProgress
	if pending.DeltaFrom != "" {
		stage = func(zipPath, target string, pending PendingUpdate, progress ApplyProgressFunc) (string, releaseManifest, error) {
			return stageDeltaRelease(zipPath, pending.InstallDir, target, pending, progress)
		}
	}
	packageRoot, manifest, err := stage(pending.ZIPPath, extractDir, pending, progress)
	if err != nil {
		return err
	}
	launchName, launchArgs, err := prepareReleaseLaunch(stateDir, transactionDir, pending, manifest)
	if err != nil {
		return err
	}
	reportApply(progress, "replace", "正在替换程序、插件与技能", 73)
	managedRoots, err := collectManagedRoots(pending.InstallDir, manifest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return err
	}
	backedUp := make([]string, 0, len(managedRoots))
	installed := make([]string, 0, len(managedRoots))
	rollback := func(cause error) error {
		var failures []error
		// Only remove paths actually written by this attempt. If backing up one
		// locked file failed, the remaining original roots were never touched.
		for index := len(installed) - 1; index >= 0; index-- {
			name := installed[index]
			if err := os.RemoveAll(filepath.Join(pending.InstallDir, name)); err != nil {
				failures = append(failures, fmt.Errorf("remove incomplete update %s: %w", name, err))
			}
		}
		for index := len(backedUp) - 1; index >= 0; index-- {
			name := backedUp[index]
			if err := os.Rename(filepath.Join(backupDir, name), filepath.Join(pending.InstallDir, name)); err != nil {
				failures = append(failures, fmt.Errorf("restore %s: %w", name, err))
			}
		}
		if len(failures) > 0 {
			return &rollbackFailure{Cause: errors.Join(append([]error{cause}, failures...)...), Backup: backupDir}
		}
		return cause
	}
	for _, name := range managedRoots {
		target := filepath.Join(pending.InstallDir, name)
		if _, err := os.Lstat(target); err == nil {
			backup := filepath.Join(backupDir, name)
			if err := os.MkdirAll(filepath.Dir(backup), 0o700); err != nil {
				return rollback(err)
			}
			if err := os.Rename(target, backup); err != nil {
				return rollback(fmt.Errorf("backup managed path %s: %w", name, err))
			}
			backedUp = append(backedUp, name)
		} else if !errors.Is(err, os.ErrNotExist) {
			return rollback(err)
		}
	}
	for _, name := range managedRoots {
		source := filepath.Join(packageRoot, name)
		if _, err := os.Lstat(source); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return rollback(err)
		}
		// A fallback copy may write only part of a directory before failing.
		installed = append(installed, name)
		if err := moveOrCopy(source, filepath.Join(pending.InstallDir, name)); err != nil {
			return rollback(fmt.Errorf("install managed path %s: %w", name, err))
		}
	}
	reportApply(progress, "runtime", "正在合并离线运行环境与本机数据", 84)
	if err := mergeReleaseData(filepath.Join(packageRoot, "data"), filepath.Join(pending.InstallDir, "data")); err != nil {
		return rollback(fmt.Errorf("merge offline runtime assets: %w", err))
	}
	if err := mergeReleaseData(filepath.Join(packageRoot, "config"), filepath.Join(pending.InstallDir, "config")); err != nil {
		return rollback(fmt.Errorf("preserve user configuration: %w", err))
	}
	if launchName == "EduWork-Electron.exe" {
		if err := electronaccess.Ensure(pending.InstallDir); err != nil {
			return rollback(fmt.Errorf("prepare Electron sandbox read access: %w", err))
		}
	}
	healthFile := filepath.Join(transactionDir, "health.ok")
	_ = os.Remove(healthFile)
	newExecutable := filepath.Join(pending.InstallDir, launchName)
	args := append(launchArgs, "--update-health-file", healthFile)
	reportApply(progress, "launch", "正在启动新版本", 91)
	command := exec.Command(newExecutable, args...)
	command.Dir = pending.InstallDir
	configureDetachedAppCommand(command)
	if err := command.Start(); err != nil {
		return rollback(fmt.Errorf("start updated application: %w", err))
	}
	reportApply(progress, "health", "正在等待新版本完成环境自检", 95)
	if err := waitForHealth(command, healthFile, 10*time.Minute); err != nil {
		if stopErr := stopUpdatedProcess(command); stopErr != nil {
			return &rollbackFailure{Cause: errors.Join(err, stopErr), Backup: backupDir}
		}
		return rollback(err)
	}
	_ = command.Process.Release()
	_ = os.Remove(PendingFile(stateDir))
	_ = os.Remove(pending.ZIPPath)
	_ = os.Remove(rejectedDeltaFile(stateDir, pending.Version))
	_ = os.Remove(filepath.Dir(pending.ZIPPath))
	reportApply(progress, "cleanup", "正在完成更新并清理临时文件", 99)
	// The health marker has already been observed, so the extracted package
	// and rollback backup no longer serve a recovery purpose. Remove the
	// current transaction only. Other backups may belong to an interrupted
	// update and must not be swept away by an unrelated successful install.
	// After a delta, backup names of files the new version has already loaded
	// share their data with the installation and cannot be deleted yet; mark
	// the transaction so the next update removes it once nothing runs.
	if os.RemoveAll(transactionDir) != nil {
		_ = os.WriteFile(filepath.Join(transactionDir, committedMarker), nil, 0o600)
	}
	return nil
}

const committedMarker = "committed"

func sweepCommittedTransactions(stateDir string) {
	root := filepath.Join(stateDir, "updates", "transactions")
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if _, err := os.Stat(filepath.Join(root, entry.Name(), committedMarker)); err == nil {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
}

func extractAndVerifyRelease(zipPath, target string, pending PendingUpdate) (string, releaseManifest, error) {
	return extractAndVerifyReleaseWithProgress(zipPath, target, pending, nil)
}

func extractAndVerifyReleaseWithProgress(zipPath, target string, pending PendingUpdate, progress ApplyProgressFunc) (string, releaseManifest, error) {
	packageRoot, actualFiles, err := extractRelease(zipPath, target, progress, 12, 33)
	if err != nil {
		return "", releaseManifest{}, err
	}
	manifest, err := readReleaseManifest(packageRoot)
	if err != nil {
		return "", releaseManifest{}, err
	}
	return packageRoot, manifest, verifyRelease(packageRoot, manifest, actualFiles, pending, progress)
}

// A delta ZIP has the layout of a full release but carries only the next
// RELEASE-MANIFEST.json, every file under user-managed roots such as config/,
// files the product rewrites at startup and the files whose identity changed.
// Every other declared file is
// hard-linked from the current installation, or copied when the volume has no
// hard links. The Electron runtime files are always copied because the sandbox
// ACL step refuses linked paths. The staged tree then passes the same complete
// verification as an extracted full package, so a locally modified program
// file fails here, before the installation is touched.
func stageDeltaRelease(zipPath, installDir, target string, pending PendingUpdate, progress ApplyProgressFunc) (string, releaseManifest, error) {
	packageRoot, actualFiles, err := extractRelease(zipPath, target, progress, 12, 8)
	if err != nil {
		return "", releaseManifest{}, err
	}
	manifest, err := readReleaseManifest(packageRoot)
	if err != nil {
		return "", releaseManifest{}, err
	}
	reused, err := reusedFiles(manifest, actualFiles)
	if err != nil {
		return "", releaseManifest{}, err
	}
	lastPercent := -1
	for index, item := range reused {
		percent := 20 + 25*(index+1)/len(reused)
		if percent != lastPercent {
			reportApply(progress, "extract", fmt.Sprintf("正在复用未变化的组件（%d / %d）", index+1, len(reused)), percent)
			lastPercent = percent
		}
		destination := filepath.Join(packageRoot, filepath.FromSlash(item.Path))
		if err := reuseInstalledFile(filepath.Join(installDir, filepath.FromSlash(item.Path)), destination, !electronaccess.Governs(item.Path)); err != nil {
			return "", releaseManifest{}, fmt.Errorf("reuse installed %s: %w", item.Path, err)
		}
		actualFiles[item.Path] = struct{}{}
	}
	return packageRoot, manifest, verifyRelease(packageRoot, manifest, actualFiles, pending, progress)
}

// reusedFiles lists the declared files a delta does not carry. They come from
// the installation, so none may sit under a user-managed root.
func reusedFiles(manifest releaseManifest, carried map[string]struct{}) ([]releaseFile, error) {
	var reused []releaseFile
	for _, item := range manifest.Files {
		if _, ok := carried[item.Path]; ok {
			continue
		}
		if !validReleasePath(item.Path) || userManagedRoot(strings.Split(item.Path, "/")[0]) {
			return nil, fmt.Errorf("delta update cannot reuse %q from the installation", item.Path)
		}
		reused = append(reused, item)
	}
	return reused, nil
}

// preflightDelta checks, while the current version still runs, that every file
// a delta reuses is intact in the installation. Staging repeats the check after
// the application exits; this pass lets an installation that the delta cannot
// serve download the complete package instead of showing a failed update.
// checked reports progress as files are verified.
func preflightDelta(ctx context.Context, zipPath, installDir string, checked func(done, total int)) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	carried := map[string]struct{}{}
	var manifestEntry *zip.File
	for _, item := range archive.File {
		parts := strings.SplitN(filepath.ToSlash(filepath.Clean(item.Name)), "/", 2)
		if len(parts) != 2 {
			continue
		}
		carried[parts[1]] = struct{}{}
		if parts[1] == "RELEASE-MANIFEST.json" {
			manifestEntry = item
		}
	}
	if manifestEntry == nil {
		return errors.New("delta update has no release manifest")
	}
	reader, err := manifestEntry.Open()
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxReleaseManifestBytes+1))
	_ = reader.Close()
	if err != nil {
		return err
	}
	manifest, err := decodeReleaseManifest(data)
	if err != nil {
		return err
	}
	reused, err := reusedFiles(manifest, carried)
	if err != nil {
		return err
	}
	checked(0, len(reused))
	for index, item := range reused {
		if err := ctx.Err(); err != nil {
			return err
		}
		path := filepath.Join(installDir, filepath.FromSlash(item.Path))
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() || info.Size() != item.Bytes {
			return fmt.Errorf("installed %s differs from the release", item.Path)
		}
		if err := verifyFileSHA256(path, item.SHA256); err != nil {
			return fmt.Errorf("installed %s differs from the release: %w", item.Path, err)
		}
		checked(index+1, len(reused))
	}
	return nil
}

// extractRelease writes a release-shaped ZIP below target and returns its
// single top-level directory with the relative paths of the files it held.
func extractRelease(zipPath, target string, progress ApplyProgressFunc, basePercent, spanPercent int) (string, map[string]struct{}, error) {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", nil, err
	}
	defer archive.Close()
	if len(archive.File) == 0 {
		return "", nil, errors.New("release ZIP is empty")
	}
	var rootName string
	actualFiles := map[string]struct{}{}
	lastExtractPercent := -1
	for index, item := range archive.File {
		percent := basePercent + spanPercent*(index+1)/len(archive.File)
		if percent != lastExtractPercent {
			reportApply(progress, "extract", fmt.Sprintf("正在解压更新组件（%d / %d）", index+1, len(archive.File)), percent)
			lastExtractPercent = percent
		}
		clean := filepath.ToSlash(filepath.Clean(item.Name))
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(clean, ":") {
			return "", nil, fmt.Errorf("unsafe ZIP entry %q", item.Name)
		}
		parts := strings.Split(clean, "/")
		if rootName == "" {
			rootName = parts[0]
		} else if parts[0] != rootName {
			return "", nil, errors.New("release ZIP must contain exactly one top-level directory")
		}
		destination := filepath.Join(target, filepath.FromSlash(clean))
		if !pathInside(target, destination) {
			return "", nil, errors.New("release ZIP entry escapes extraction directory")
		}
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0o755); err != nil {
				return "", nil, err
			}
			continue
		}
		if !item.Mode().IsRegular() {
			return "", nil, fmt.Errorf("release ZIP contains unsupported entry %q", item.Name)
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return "", nil, err
		}
		reader, err := item.Open()
		if err != nil {
			return "", nil, err
		}
		file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, item.Mode().Perm())
		if err != nil {
			_ = reader.Close()
			return "", nil, err
		}
		_, copyErr := io.Copy(file, reader)
		closeErr := errors.Join(file.Close(), reader.Close())
		if copyErr != nil || closeErr != nil {
			return "", nil, errors.Join(copyErr, closeErr)
		}
		if len(parts) > 1 {
			actualFiles[strings.Join(parts[1:], "/")] = struct{}{}
		}
	}
	return filepath.Join(target, rootName), actualFiles, nil
}

func readReleaseManifest(packageRoot string) (releaseManifest, error) {
	data, err := os.ReadFile(filepath.Join(packageRoot, "RELEASE-MANIFEST.json"))
	if err != nil {
		return releaseManifest{}, err
	}
	return decodeReleaseManifest(data)
}

// verifyRelease checks the release identity, every declared file's size and
// SHA-256, and that the tree holds no undeclared file.
func verifyRelease(packageRoot string, manifest releaseManifest, actualFiles map[string]struct{}, pending PendingUpdate, progress ApplyProgressFunc) error {
	if manifest.SchemaVersion != 1 || manifest.LauncherVersion != pending.Version || !strings.EqualFold(manifest.Flavor, pending.Flavor) {
		return errors.New("release manifest does not match the pending update")
	}
	if err := validateReleaseLaunch(pending, manifest); err != nil {
		return err
	}
	expected := map[string]struct{}{"RELEASE-MANIFEST.json": {}}
	lastVerifyPercent := -1
	for index, item := range manifest.Files {
		percent := 46
		if len(manifest.Files) > 0 {
			percent += 24 * (index + 1) / len(manifest.Files)
		}
		if percent != lastVerifyPercent {
			reportApply(progress, "verify-files", fmt.Sprintf("正在校验更新组件（%d / %d）", index+1, len(manifest.Files)), percent)
			lastVerifyPercent = percent
		}
		if !validReleasePath(item.Path) {
			return fmt.Errorf("unsafe release payload path %q", item.Path)
		}
		if item.Bytes < 0 || !sha256Pattern.MatchString(item.SHA256) {
			return fmt.Errorf("invalid release payload identity for %s", item.Path)
		}
		if _, duplicate := expected[item.Path]; duplicate {
			return fmt.Errorf("duplicate release payload path %s", item.Path)
		}
		expected[item.Path] = struct{}{}
		path := filepath.Join(packageRoot, filepath.FromSlash(item.Path))
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() != item.Bytes {
			return fmt.Errorf("release payload size mismatch for %s", item.Path)
		}
		if err := verifyFileSHA256(path, item.SHA256); err != nil {
			return fmt.Errorf("release payload hash mismatch for %s: %w", item.Path, err)
		}
	}
	if len(actualFiles) != len(expected) {
		return errors.New("release ZIP contains undeclared or missing files")
	}
	for name := range actualFiles {
		if _, ok := expected[name]; !ok {
			return fmt.Errorf("release ZIP contains undeclared file %s", name)
		}
	}
	return nil
}

func validReleasePath(path string) bool {
	clean := filepath.ToSlash(filepath.Clean(path))
	return clean == path && clean != "." && !strings.HasPrefix(clean, "../") && !strings.HasPrefix(clean, "/") && !strings.Contains(clean, ":")
}

// userManagedRoot names the top-level paths a release never replaces.
func userManagedRoot(name string) bool {
	switch strings.ToLower(name) {
	case "data", "config", ".env", ".env.local":
		return true
	}
	return false
}

func reuseInstalledFile(source, target string, link bool) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("installed path is not a regular file")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if link && os.Link(source, target) == nil {
		return nil
	}
	return copyFileReplace(source, target, info.Mode().Perm())
}

func decodeReleaseManifest(data []byte) (releaseManifest, error) {
	if len(data) > maxReleaseManifestBytes {
		return releaseManifest{}, errors.New("release manifest is too large")
	}
	var manifest releaseManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return releaseManifest{}, err
	}
	return manifest, nil
}

func collectManagedRoots(installDir string, next releaseManifest) ([]string, error) {
	roots := map[string]struct{}{}
	add := func(path string) error {
		path = filepath.ToSlash(path)
		if path == "" || path == "." || path == ".." || path != filepath.ToSlash(filepath.Clean(path)) || strings.HasPrefix(path, "../") || strings.HasPrefix(path, "/") || strings.Contains(path, ":") {
			return fmt.Errorf("invalid managed release path %q", path)
		}
		if name := strings.Split(path, "/")[0]; !userManagedRoot(name) {
			roots[name] = struct{}{}
		}
		return nil
	}
	for _, item := range next.Files {
		if err := add(item.Path); err != nil {
			return nil, err
		}
	}
	add("RELEASE-MANIFEST.json")
	if data, err := os.ReadFile(filepath.Join(installDir, "RELEASE-MANIFEST.json")); err == nil {
		var previous releaseManifest
		if json.Unmarshal(data, &previous) == nil && previous.SchemaVersion == 1 {
			for _, item := range previous.Files {
				if err := add(item.Path); err != nil {
					return nil, err
				}
			}
			add("RELEASE-MANIFEST.json")
		}
	}
	result := make([]string, 0, len(roots))
	for name := range roots {
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}

type rollbackFailure struct {
	Cause  error
	Backup string
}

func (err *rollbackFailure) Error() string {
	return fmt.Sprintf("%v; automatic recovery incomplete; original files retained at %s", err.Cause, err.Backup)
}
func (err *rollbackFailure) Unwrap() error { return err.Cause }

func waitForHealth(command *exec.Cmd, healthFile string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	lastProgress := time.Now()
	lastSnapshot := ""
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(healthFile); err == nil {
			snapshot := strings.TrimSpace(string(data))
			if snapshot == "ok" {
				return nil
			}
			if snapshot != "" && snapshot != lastSnapshot {
				var heartbeat struct {
					SchemaVersion int    `json:"schemaVersion"`
					State         string `json:"state"`
					Message       string `json:"message"`
				}
				if json.Unmarshal(data, &heartbeat) == nil && heartbeat.SchemaVersion == 1 {
					lastSnapshot = snapshot
					lastProgress = time.Now()
					if heartbeat.State == "failed" {
						return fmt.Errorf("updated application reported startup failure: %s", heartbeat.Message)
					}
				}
			}
		}
		if processExited(command) {
			return errors.New("updated application exited before startup health confirmation")
		}
		if time.Since(lastProgress) > 2*time.Minute {
			return errors.New("updated application startup health stopped making progress")
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("updated application did not confirm startup health in time")
}

func loadPendingPath(path string) (PendingUpdate, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return PendingUpdate{}, "", err
	}
	var pending PendingUpdate
	if err := json.Unmarshal(data, &pending); err != nil {
		return PendingUpdate{}, "", err
	}
	stateDir := filepath.Dir(filepath.Dir(path))
	if filepath.Clean(path) != filepath.Clean(PendingFile(stateDir)) || pending.SchemaVersion != pendingSchemaVersion {
		return PendingUpdate{}, "", errors.New("pending update path or schema is invalid")
	}
	return pending, stateDir, nil
}

func validatePendingPaths(stateDir string, pending PendingUpdate) error {
	for label, path := range map[string]string{"state": stateDir, "install": pending.InstallDir, "zip": pending.ZIPPath} {
		if strings.TrimSpace(path) == "" || !filepath.IsAbs(path) {
			return fmt.Errorf("pending update %s path must be absolute", label)
		}
	}
	if !pathInside(filepath.Join(stateDir, "updates", "downloads"), pending.ZIPPath) {
		return errors.New("pending update ZIP is outside the private download directory")
	}
	if filepath.Base(pending.ExecutableName) != pending.ExecutableName || pending.ExecutableName == "" {
		return errors.New("pending executable name is invalid")
	}
	return nil
}

func recordApplyFailure(stateDir string, pending PendingUpdate, applyErr error) error {
	if pending.DeltaFrom != "" {
		rejectDelta(stateDir, pending.Version, pending.ZIPPath, applyErr)
	}
	pending.State = "error"
	pending.Error = applyErr.Error()
	pending.InstallOnNextStart = false
	_ = SavePending(stateDir, pending)
	logPath := filepath.Join(stateDir, "updates", "last-update-error.txt")
	_ = os.WriteFile(logPath, []byte(time.Now().Format(time.RFC3339)+" "+applyErr.Error()+"\n"), 0o600)
	return applyErr
}

func verifyFileSHA256(path, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(strings.TrimSpace(expected)) {
		return errors.New("SHA-256 mismatch")
	}
	return nil
}

func moveOrCopy(source, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if err := os.Rename(source, target); err == nil {
		return nil
	}
	return copyTree(source, target, false)
}

func mergeReleaseData(source, target string) error {
	if _, err := os.Stat(source); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return copyTree(source, target, true)
}

func copyTree(source, target string, skipExisting bool) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("update payload contains a filesystem link")
	}
	if existing, e := os.Lstat(target); e == nil {
		if skipExisting && !info.IsDir() {
			return nil
		}
		if existing.Mode()&os.ModeSymlink != 0 {
			return errors.New("update destination contains a filesystem link")
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if !info.IsDir() {
		if skipExisting {
			if _, err := os.Stat(target); err == nil {
				return nil
			}
		}
		return copyFileReplace(source, target, info.Mode().Perm())
	}
	if err := os.MkdirAll(target, info.Mode().Perm()); err != nil {
		return err
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyTree(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name()), skipExisting); err != nil {
			return err
		}
	}
	return nil
}

func copyFileReplace(source, target string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(target), ".update-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err := io.Copy(temp, input); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Chmod(mode); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	_ = os.Remove(target)
	return os.Rename(name, target)
}

func pathInside(root, target string) bool {
	root, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}
