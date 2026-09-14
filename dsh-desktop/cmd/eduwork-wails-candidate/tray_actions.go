package main

import (
	"context"
	"encoding/json"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/tray"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"time"
)

func trayActionScript(action tray.Action) string {
	if action != tray.ActionNewSession && action != tray.ActionSettings {
		return ""
	}
	value, _ := json.Marshal(string(action))
	return `(window.__eduworkTrayActions ??= []).push(` + string(value) + `); window.dispatchEvent(new Event('eduwork:tray-action'));`
}

var updateCheckBusy atomic.Bool

func checkCandidateUpdates(window context.Context, node, host, config, version string) {
	if !updateCheckBusy.CompareAndSwap(false, true) {
		return
	}
	defer updateCheckBusy.Store(false)
	ctx, cancel := context.WithTimeout(window, 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, node, filepath.Join(host, "desktop-updates.mjs"), config, version, "wails")
	hideProcess(command)
	bytes, err := command.Output()
	var result struct {
		Phase   string `json:"phase"`
		Message string `json:"message"`
		URL     string `json:"url"`
	}
	if err != nil || json.Unmarshal(bytes, &result) != nil {
		result.Message = "未能检查更新，请检查配置文件中的 updates 和网络连接。"
	}
	buttons := []string{"确定"}
	if result.URL != "" {
		buttons = []string{"打开发布页面", "取消"}
	}
	selected, _ := wr.MessageDialog(window, wr.MessageDialogOptions{Type: wr.InfoDialog, Title: "检查更新", Message: result.Message, Buttons: buttons, DefaultButton: buttons[0]})
	if selected == "打开发布页面" && result.URL != "" {
		wr.BrowserOpenURL(window, result.URL)
	}
}
