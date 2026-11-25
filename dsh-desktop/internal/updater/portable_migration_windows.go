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

func RunPortableMigration(args []string) error {
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
	if options.NArg() != 0 || *mode != "install" || !migrationDistribution.MatchString(*distribution) || !migrationID.MatchString(*intent) || *parent <= 0 || *parent > 1<<31-1 || os.Getenv("EDUWORK_DESKTOP_TEST_DATA_ROOT") != "" {
		return errors.New("invalid portable migration arguments")
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(self)))
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) || !filepath.IsAbs(*installer) || !strings.EqualFold(self, filepath.Join(root, "resources", "update", "EduWork-Updater.exe")) {
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
	if !*worker {
		command := exec.Command(self, append(append([]string{"portable-migration"}, args...), "--worker")...)
		configureDetachedHelperCommand(command)
		if err := command.Start(); err != nil {
			return err
		}
		_ = command.Process.Release()
		return nil
	}
	err = runMigrationInstaller(cache, directory, root, desktop, *parent, *intent, *installer, *algorithm, *digest, *bytes)
	if err != nil {
		message := windows.StringToUTF16Ptr("未能启动迁移安装程序。旧数据未修改，请重新打开旧客户端核对或撤销待迁移。\n\n" + err.Error())
		caption := windows.StringToUTF16Ptr("EduWork 迁移未完成")
		windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(caption)), 0x10)
	}
	return err
}

func runMigrationInstaller(cache, directory, root string, desktop migrationIdentity, parent int, intentID, installer, algorithm, digest string, bytes int64) error {
	if err := waitForProcessExit(parent, 30*time.Second); err != nil {
		return err
	}
	release, err := installguard.Acquire(cache)
	if err != nil {
		return err
	}
	defer release()
	var intent migrationIntent
	if err := readMigrationJSON(filepath.Join(directory, desktop.Distribution+".portable-migration.json"), &intent); err != nil {
		return err
	}
	comparison, err := CompareVersions(intent.InstallerVersion, desktop.ProductVersion)
	if err != nil || comparison < 0 || intent.SchemaVersion != 1 || intent.ID != intentID || intent.Distribution != desktop.Distribution || !strings.EqualFold(intent.SourceRoot, root) || intent.SourceVersion != desktop.ProductVersion || !migrationInstallerPath(cache, installer, desktop.ProductName, intent.InstallerVersion) {
		return errors.New("installer does not match portable migration intent")
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
	err = command.Wait()
	_ = os.Remove(installer)
	_ = os.Remove(filepath.Dir(installer))
	return err
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
