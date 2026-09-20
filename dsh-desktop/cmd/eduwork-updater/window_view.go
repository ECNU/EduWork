package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

type installerIdentity struct{ Name, Version, Icon string }

// Read presentation before any product files are replaced.
func readInstallerIdentity(pendingPath string) installerIdentity {
	identity := installerIdentity{Name: "EduWork"}
	var pending updater.PendingUpdate
	if body, err := os.ReadFile(pendingPath); err != nil || json.Unmarshal(body, &pending) != nil {
		return identity
	}
	identity.Version = pending.Version
	if !filepath.IsAbs(pending.InstallDir) {
		return identity
	}
	var desktop struct {
		ProductName string `json:"productName"`
	}
	if body, err := os.ReadFile(filepath.Join(pending.InstallDir, "resources/app/eduwork.desktop.json")); err == nil && json.Unmarshal(body, &desktop) == nil {
		if name := strings.TrimSpace(desktop.ProductName); name != "" && len([]rune(name)) <= 80 {
			identity.Name = name
		}
	}
	identity.Icon = filepath.Join(pending.InstallDir, "resources/brand/icon.ico")
	return identity
}

func installerStage(stage string) int {
	switch stage {
	case "replace", "runtime":
		return 1
	case "launch", "health":
		return 2
	case "cleanup", "done":
		return 3
	default:
		return 0
	}
}

func installerHeading(stage string) string {
	switch stage {
	case "waiting":
		return "正在准备更新"
	case "extract":
		return "正在解压更新文件"
	case "verify-package", "verify-files":
		return "正在校验更新文件"
	case "replace", "runtime":
		return "正在安装新版本"
	case "launch", "health":
		return "正在启动并检查新版本"
	case "cleanup", "done":
		return "更新即将完成"
	default:
		return "正在准备更新"
	}
}
