//go:build windows

package updater

import (
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unsafe"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
	"golang.org/x/sys/windows"
)

var migrationDistribution = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,99}$`)
var migrationID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type migrationIdentity struct {
	SchemaVersion     int    `json:"schemaVersion"`
	Shell             string `json:"shell"`
	DataLayout        string `json:"dataLayout"`
	Distribution      string `json:"distribution"`
	ProductName       string `json:"productName"`
	ProductVersion    string `json:"productVersion"`
	AppID             string `json:"appId"`
	PortableMigration bool   `json:"portableMigration"`
}

type migrationIntent struct {
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	Distribution     string `json:"distribution"`
	SourceRoot       string `json:"sourceRoot"`
	SourceVersion    string `json:"sourceVersion"`
	InstallerVersion string `json:"installerVersion"`
}

func readMigrationJSON(path string, result any) error {
	if err := requireMigrationPath(path); err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	const limit = 8 << 10
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return err
	}
	if len(data) > limit {
		return errors.New("invalid portable migration metadata size")
	}
	return json.Unmarshal(data, result)
}

func requireMigrationPath(path string) error {
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if !strings.EqualFold(canonical, filepath.Clean(path)) {
		return fmt.Errorf("portable migration path is not canonical: %s", filepath.Base(path))
	}
	return nil
}

func verifyMigrationInstaller(path, algorithm, digest string, bytes int64) (*os.File, error) {
	var checksum hash.Hash
	switch algorithm {
	case "sha256":
		checksum = sha256.New()
	case "sha512":
		checksum = sha512.New()
	default:
		return nil, errors.New("unsupported portable migration checksum")
	}
	if bytes <= 0 || bytes > 1<<31 || len(digest) != checksum.Size()*2 {
		return nil, errors.New("invalid portable migration installer metadata")
	}
	if err := requireMigrationPath(path); err != nil {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), path)
	info, err := file.Stat()
	if err == nil && info.Mode().IsRegular() && info.Size() == bytes {
		var copied int64
		copied, err = io.Copy(checksum, io.LimitReader(file, bytes+1))
		if err == nil && copied == bytes && hex.EncodeToString(checksum.Sum(nil)) == digest {
			return file, nil
		}
	}
	file.Close()
	return nil, errors.New("portable migration installer does not match its verified size or checksum")
}

func migrationInstallerPath(cache, installer, product, version string) bool {
	relative, err := filepath.Rel(cache, installer)
	if err != nil {
		return false
	}
	parts := strings.Split(relative, string(filepath.Separator))
	return len(parts) == 2 && strings.HasPrefix(parts[0], "installer-") && parts[1] == product+"-Setup-"+version+"-x64.exe"
}

func installedMigrationExecutable(local, distribution, minimum string) (string, error) {
	root := filepath.Join(local, "Programs", "EduWork", distribution)
	var installed migrationIdentity
	if err := readMigrationJSON(filepath.Join(root, "resources", "app", "eduwork.desktop.json"), &installed); err != nil {
		return "", err
	}
	if installed.SchemaVersion != 1 || installed.Shell != "electron" || installed.DataLayout != "installed" || installed.Distribution != distribution || installed.AppID != "org.eduwork."+distribution+".electron" {
		return "", errors.New("installed EduWork identity does not match the portable edition")
	}
	if minimum == "" {
		minimum = installed.ProductVersion
	}
	if comparison, err := CompareVersions(installed.ProductVersion, minimum); err != nil || comparison < 0 {
		return "", errors.New("installed EduWork does not meet the migration version")
	}
	executable := filepath.Join(root, "EduWork-Electron.exe")
	if err := requireMigrationPath(executable); err != nil {
		return "", err
	}
	info, err := os.Lstat(executable)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("installed EduWork executable is missing or invalid")
	}
	return executable, nil
}

func startInstalledMigration(executable string) error {
	command := exec.Command(executable)
	command.Dir = filepath.Dir(executable)
	configureMigrationAppCommand(command)
	if err := command.Start(); err != nil {
		return err
	}
	_ = command.Process.Release()
	return nil
}

func readMatchingMigrationIntent(path, root, intentID string, desktop migrationIdentity) (migrationIntent, error) {
	var intent migrationIntent
	if err := readMigrationJSON(path, &intent); err != nil {
		return intent, err
	}
	comparison, err := CompareVersions(intent.InstallerVersion, intent.SourceVersion)
	if err != nil || comparison < 0 || intent.SchemaVersion != 1 || intent.ID != intentID || intent.Distribution != desktop.Distribution || !strings.EqualFold(intent.SourceRoot, root) {
		return intent, errors.New("portable migration intent no longer matches this source")
	}
	return intent, nil
}

func RunPortableMigration(args []string) (result error) {
	options := flag.NewFlagSet("portable-migration", flag.ContinueOnError)
	mode := options.String("mode", "", "")
	distribution := options.String("distribution", "", "")
	parent := options.Int("parent-pid", 0, "")
	installer := options.String("installer", "", "")
	bytes := options.Int64("bytes", 0, "")
	algorithm := options.String("algorithm", "", "")
	digest := options.String("digest", "", "")
	intent := options.String("intent", "", "")
	worker := options.Bool("worker", false, "")
	if err := options.Parse(args); err != nil {
		return err
	}
	needIntent := *mode != "redirect" || *intent != ""
	detached := *mode == "install" || *mode == "redirect"
	if options.NArg() != 0 || (!detached && *mode != "probe" && *mode != "withdraw") || (!detached && *worker) ||
		!migrationDistribution.MatchString(*distribution) || (needIntent && !migrationID.MatchString(*intent)) ||
		*parent <= 0 || *parent > 1<<31-1 || os.Getenv("EDUWORK_DESKTOP_TEST_DATA_ROOT") != "" {
		return errors.New("invalid portable migration arguments")
	}
	if *worker {
		defer func() { showMigrationWorkerError(result) }()
		if err := waitForProcessExit(*parent, 30*time.Second); err != nil {
			return err
		}
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(self)))
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) || (*mode == "install" && !filepath.IsAbs(*installer)) || !strings.EqualFold(self, filepath.Join(root, "resources", "update", "EduWork-Updater.exe")) {
		return errors.New("invalid portable migration roots")
	}
	var desktop migrationIdentity
	if err := readMigrationJSON(filepath.Join(root, "resources", "app", "eduwork.desktop.json"), &desktop); err != nil {
		return err
	}
	if desktop.SchemaVersion != 1 || desktop.Shell != "electron" || desktop.DataLayout != "" || desktop.Distribution != *distribution || !desktop.PortableMigration {
		return errors.New("portable migration is disabled for this package")
	}
	directory := filepath.Join(local, "EduWork")
	cache := filepath.Join(directory, *distribution+".portable-installers")
	intentPath := filepath.Join(directory, *distribution+".portable-migration.json")
	if *mode == "withdraw" {
		release, err := installguard.Acquire(cache)
		if err != nil {
			return err
		}
		defer release()
		if _, err := readMatchingMigrationIntent(intentPath, root, *intent, desktop); err != nil {
			return err
		}
		return os.Remove(intentPath)
	}
	if *mode == "probe" || *mode == "redirect" {
		minimum := ""
		if *intent != "" {
			row, err := readMatchingMigrationIntent(intentPath, root, *intent, desktop)
			if err != nil {
				return err
			}
			minimum = row.InstallerVersion
		}
		executable, err := installedMigrationExecutable(local, *distribution, minimum)
		if err != nil || *mode == "probe" {
			return err
		}
		if *worker {
			return startInstalledMigration(executable)
		}
	}
	if !*worker {
		command := exec.Command(self, append(append([]string{"portable-migration"}, args...), "--worker")...)
		configureDetachedHelperCommand(command)
		if err := command.Start(); err != nil {
			return err
		}
		_ = command.Process.Release()
		return nil
	}
	return runMigrationInstaller(cache, intentPath, local, root, desktop, *intent, *installer, *algorithm, *digest, *bytes)
}

func showMigrationWorkerError(err error) {
	if err != nil {
		message := windows.StringToUTF16Ptr("未能打开 EduWork 安装版。旧数据未修改，请重新打开旧客户端核对。\n\n" + err.Error())
		caption := windows.StringToUTF16Ptr("EduWork 迁移未完成")
		windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(caption)), 0x10)
	}
}

func runMigrationInstaller(cache, intentPath, local, root string, desktop migrationIdentity, intentID, installer, algorithm, digest string, bytes int64) error {
	release, err := installguard.Acquire(cache)
	if err != nil {
		return err
	}
	defer release()
	intent, err := readMatchingMigrationIntent(intentPath, root, intentID, desktop)
	if err != nil {
		return err
	}
	if intent.SourceVersion != desktop.ProductVersion || !migrationInstallerPath(cache, installer, desktop.ProductName, intent.InstallerVersion) {
		return errors.New("installer does not match portable migration intent")
	}
	if err := requireMigrationPath(installer); err != nil {
		return err
	}
	defer func() {
		_ = os.Remove(installer)
		_ = os.Remove(filepath.Dir(installer))
	}()
	if executable, err := installedMigrationExecutable(local, desktop.Distribution, intent.InstallerVersion); err == nil {
		return startInstalledMigration(executable)
	}
	file, err := verifyMigrationInstaller(installer, algorithm, digest, bytes)
	if err != nil {
		return err
	}
	command := exec.Command(installer, "--updated", "--force-run", "--eduwork-portable-migration")
	command.Dir = filepath.Dir(installer)
	configureMigrationAppCommand(command)
	err = command.Start()
	file.Close()
	if err != nil {
		return err
	}
	return command.Wait()
}

func configureMigrationAppCommand(command *exec.Cmd) {
	configureDetachedAppCommand(command)
	filtered := command.Env[:0]
	for _, entry := range command.Env {
		name, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(name) {
		case "DSH_HOME", "DSH_DESKTOP_DIAGNOSTIC_FILE", "EDUWORK_CONFIG_FILE":
		default:
			filtered = append(filtered, entry)
		}
	}
	command.Env = filtered
}
