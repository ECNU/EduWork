package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updatecontrol"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Keep the old updater's literal acknowledgement. No success marker is written
// until the new Host and its renderer entry have both been checked.
func validateBridgeHealth(root, path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("update health path must be absolute")
	}
	path = filepath.Clean(path)
	base := filepath.Join(root, "data", "state", "updates", "transactions")
	rel, err := filepath.Rel(base, path)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.Base(path) != "health.ok" || filepath.Dir(rel) == "." || filepath.Dir(filepath.Dir(rel)) != "." {
		return "", errors.New("invalid update health location")
	}
	// Reject linked transaction ancestors before writing outside the install.
	for p := filepath.Dir(path); !strings.EqualFold(p, filepath.Clean(root)); p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("linked update health directory")
		}
		if e != nil && !os.IsNotExist(e) {
			return "", e
		}
		if filepath.Dir(p) == p {
			return "", errors.New("invalid update health root")
		}
	}
	return path, nil
}
func bridgeHealth(path, state, message string) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	bytes := []byte("ok\n")
	if state != "ready" {
		bytes, _ = json.Marshal(map[string]any{"schemaVersion": 1, "state": state, "message": message})
	}
	return os.WriteFile(path, bytes, 0600)
}
func runBridgeApply(args []string) error {
	f := flag.NewFlagSet("apply-update", flag.ContinueOnError)
	pending := f.String("pending", "", "verified pending update")
	pid := f.Int("pid", 0, "old desktop PID")
	if err := f.Parse(args); err != nil {
		return err
	}
	if *pending == "" {
		return errors.New("apply-update requires --pending")
	}
	if os.Getenv("CHATECNU_UPDATE_HELPER_HEADLESS") == "1" {
		return updater.ApplyPending(*pending, *pid)
	}
	return runBridgeApplyWindow(*pending, *pid)
}

type bridgeUpdates struct {
	manager *updatecontrol.Manager
	window  context.Context
	busy    atomic.Bool
}

func newBridgeUpdates(config candidateConfig, root string, window context.Context, exit func()) (*bridgeUpdates, error) {
	if !config.Bridge {
		return nil, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	manager, err := updatecontrol.New(updatecontrol.Config{Version: config.ProductVersion, DefaultPolicy: config.UpdateDefaultPolicy, EditionPath: filepath.Join(root, "config", "update.bridge.json"), StateDir: filepath.Join(root, "data", "state"), InstallDir: root, ExecutableName: filepath.Base(exe), UpdateHealthFile: config.HealthFile, RequestExit: exit})
	if err != nil {
		return nil, fmt.Errorf("请检查 config/update.bridge.json：%w", err)
	}
	go manager.AutoCheck()
	return &bridgeUpdates{manager: manager, window: window}, nil
}
func (b *bridgeUpdates) status() map[string]any {
	s := b.manager.Status()
	message := "Go 过渡版支持下载更新、重启安装及升级至 Electron；更新后保留本机数据。"
	if !s.Enabled {
		message = "过渡升级器已就绪，发行方尚未启用更新渠道。配置文件：config/update.bridge.json。"
	}
	if s.State == "downloading" {
		message = fmt.Sprintf("正在下载更新：%.1f / %.1f MiB", float64(s.DownloadedBytes)/(1024*1024), float64(s.TotalBytes)/(1024*1024))
	}
	if s.InstallOnNextStart {
		message = "更新包已校验，将在下次启动时安装。"
	}
	return map[string]any{"shell": "wails", "version": s.CurrentVersion, "phase": s.State, "message": message, "update": s}
}
func (b *bridgeUpdates) open() {
	wr.WindowShow(b.window)
	wr.WindowExecJS(b.window, `window.dispatchEvent(new Event('eduwork:open-updates'));`)
}
func (b *bridgeUpdates) action(action string) map[string]any {
	switch action {
	case "use-stable-updates", "use-development-updates":
		policy := "stable"
		if action == "use-development-updates" {
			policy = "development"
		}
		if _, err := b.manager.SetPolicy(policy); err != nil {
			return map[string]any{"shell": "wails", "version": b.manager.Status().CurrentVersion, "phase": "error", "message": err.Error(), "update": b.manager.Status()}
		}
	case "check-updates":
		if b.busy.CompareAndSwap(false, true) {
			go func() {
				defer b.busy.Store(false)
				ctx, cancel := context.WithTimeout(b.window, 25*time.Second)
				defer cancel()
				_, _ = b.manager.Check(ctx)
			}()
		}
	case "download-update":
		if b.busy.CompareAndSwap(false, true) {
			go func() { defer b.busy.Store(false); _, _ = b.manager.Download(b.window) }()
		}
	case "schedule-update":
		if _, err := b.manager.ScheduleNextStart(); err != nil {
			return map[string]any{"shell": "wails", "version": b.manager.Status().CurrentVersion, "phase": "error", "message": err.Error(), "update": b.manager.Status()}
		}
	case "install-update":
		if _, err := b.manager.InstallNow(); err != nil {
			return map[string]any{"shell": "wails", "version": b.manager.Status().CurrentVersion, "phase": "error", "message": err.Error(), "update": b.manager.Status()}
		}
	}
	return b.status()
}
