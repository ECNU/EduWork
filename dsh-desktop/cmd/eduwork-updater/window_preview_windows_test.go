//go:build windows

package main

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

// Opt-in visual fixture only: it never calls the real installer or opens user data.
func TestInstallerWindowPreview(t *testing.T) {
	mode := os.Getenv("EDUWORK_INSTALLER_PREVIEW")
	if mode == "" {
		t.Skip("visual fixture is opt-in")
	}
	err := runInstallerWindow(installerIdentity{Name: "EduWork@ECNU", Version: "0.3.6-dev.preview", Icon: os.Getenv("EDUWORK_INSTALLER_PREVIEW_ICON")}, func(report updater.ApplyProgressFunc) error {
		report(updater.ApplyProgress{Stage: "verify-files", Message: "正在校验更新组件（8227 / 39487）", Percent: 48})
		if mode == "failure" {
			time.Sleep(300 * time.Millisecond)
			return errors.New("校验更新文件未通过，尚未替换当前安装。\r\n\r\n示例错误：update package checksum mismatch\r\n请重新下载更新包后重试。\r\n\r\n这是界面预览，不会安装或修改任何文件。")
		}
		time.Sleep(45 * time.Second)
		return nil
	})
	if mode != "failure" && err != nil {
		t.Fatal(err)
	}
}
