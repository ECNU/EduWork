// Official Host Wails shell with an opt-in legacy upgrade bridge.
package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type candidateConfig struct {
	SchemaVersion       int            `json:"schemaVersion"`
	Shell               string         `json:"shell"`
	AppID               string         `json:"appId"`
	Distribution        string         `json:"distribution"`
	ProductName         string         `json:"productName"`
	ProductVersion      string         `json:"productVersion"`
	Product             string         `json:"product"`
	Node                string         `json:"node"`
	Host                string         `json:"host"`
	Bridge              bool           `json:"bridge,omitempty"`
	UpdateDefaultPolicy string         `json:"updateDefaultPolicy,omitempty"`
	HealthFile          string         `json:"-"`
	ImportLegacy        bool           `json:"-"`
	Updates             *bridgeUpdates `json:"-"`
}
type profileResult struct {
	Profile     string            `json:"profile"`
	Environment map[string]string `json:"environment"`
	Desktop     struct {
		ProductName string `json:"productName"`
		CloseAction string `json:"closeAction"`
	} `json:"desktop"`
}

func token() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
func at(root, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(root, path)
}
func envWith(environment map[string]string) []string {
	result := make([]string, 0, len(os.Environ())+len(environment))
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		replaced := false
		for selected := range environment {
			if strings.EqualFold(key, selected) {
				replaced = true
				break
			}
		}
		if !replaced {
			result = append(result, entry)
		}
	}
	for key, value := range environment {
		result = append(result, key+"="+value)
	}
	return result
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "apply-update" {
		return runBridgeApply(args[1:])
	}
	if len(args) > 0 && args[0] == "run" {
		args = args[1:]
	}
	flags := flag.NewFlagSet("eduwork-wails-candidate", flag.ContinueOnError)
	configPath := flags.String("config", "", "isolated desktop candidate manifest")
	homeFlag := flags.String("home", "", "isolated data directory; default candidate/Data")
	privateConfig := flags.String("private-config", "", "optional local profile overrides")
	userConfig := flags.String("user-config", "", "public JSONC config; default config/eduwork.jsonc beside the executable")
	probe := flags.Bool("probe", false, "probe real official Host without opening a window")
	readyFile := flags.String("write-ready", "", "write non-secret readiness evidence")
	exitAfter := flags.Duration("exit-after", 0, "optional UI test duration; zero keeps the app open")
	healthFile := flags.String("update-health-file", "", "legacy updater health acknowledgement")
	noWindow := flags.Bool("no-window", false, "legacy headless Host probe")
	programRoot := flags.String("program-root", "", "portable install directory")
	dataRoot := flags.String("data-root", "", "legacy data directory")
	showVersion := flags.Bool("version", false, "show product version")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *configPath == "" {
		executable, err := os.Executable()
		if err != nil {
			return err
		}
		*configPath = filepath.Join(filepath.Dir(executable), "eduwork.desktop.json")
		if *programRoot != "" {
			*configPath = filepath.Join(*programRoot, "eduwork.desktop.json")
		}
	}
	configAbsolute, err := filepath.Abs(*configPath)
	if err != nil {
		return err
	}
	bytes, err := os.ReadFile(configAbsolute)
	if err != nil {
		return err
	}
	var config candidateConfig
	if err := json.Unmarshal(bytes, &config); err != nil {
		return err
	}
	if config.SchemaVersion != 1 || config.Shell != "wails" || config.AppID == "" || !regexp.MustCompile(`^[a-z0-9-]+$`).MatchString(config.Distribution) || config.ProductName == "" || config.Product == "" || config.Node == "" || config.Host == "" {
		return errors.New("invalid Wails candidate manifest")
	}
	root := filepath.Dir(configAbsolute)
	if *showVersion {
		fmt.Println(config.ProductName + " " + config.ProductVersion)
		return nil
	}
	if *dataRoot != "" && !strings.EqualFold(filepath.Clean(*dataRoot), filepath.Join(root, "data")) {
		return errors.New("此过渡版仅自动迁移程序目录内的 data；外置数据目录请先单独迁移，原数据未修改")
	}
	config.HealthFile, err = validateBridgeHealth(root, *healthFile)
	if err != nil {
		return err
	}
	node := at(root, config.Node)
	host := at(root, config.Host)
	product := at(root, config.Product)
	home := filepath.Join(root, "data", config.Distribution+"-wails", "dsh")
	if *homeFlag != "" {
		home, err = filepath.Abs(*homeFlag)
		if err != nil {
			return err
		}
	}
	if config.Bridge {
		config.ImportLegacy = *homeFlag == ""
	}
	if *noWindow {
		*probe = true
	}
	return runCandidateWindow(config, root, node, host, product, home, *privateConfig, *userConfig, *probe, *readyFile, *exitAfter)
}
