// Package installguard coordinates installers and update helpers for one installation.
package installguard

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var ErrBusy = errors.New("此目录正在安装或更新，请等待完成后重试")
var ErrUpdateActive = errors.New("应用正在更新或恢复，请等待更新完成后再覆盖安装")

func Acquire(target string) (func(), error) {
	canonical, err := filepath.Abs(target)
	if err != nil {
		return nil, err
	}
	canonical, err = filepath.EvalSymlinks(canonical)
	if err != nil {
		return nil, err
	}
	return acquire(canonical)
}

// CheckUpdateIdle also protects installations whose older helper does not yet
// participate in the shared lease. Missing or unreadable recovery evidence is
// never repaired/deleted by the installer.
func CheckUpdateIdle(target string) error {
	root, err := os.OpenRoot(target)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.Open("data/state/updates/pending-update.json")
	if err == nil {
		const limit = 1 << 20
		data, readErr := io.ReadAll(io.LimitReader(f, limit+1))
		closeErr := f.Close()
		if readErr != nil || closeErr != nil {
			return fmt.Errorf("无法确认更新状态，请稍后重试：%w", errors.Join(readErr, closeErr))
		}
		var pending struct {
			State string `json:"state"`
		}
		if len(data) > limit || json.Unmarshal(data, &pending) != nil || pending.State == "" {
			return errors.New("更新记录无法读取，请先恢复更新后再覆盖安装")
		}
		if pending.State != "ready" && pending.State != "error" {
			return ErrUpdateActive
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("无法确认更新状态，请稍后重试：%w", err)
	}
	transactions, err := root.Open("data/state/updates/transactions")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	entries, readErr := transactions.ReadDir(-1)
	closeErr := transactions.Close()
	if err = errors.Join(readErr, closeErr); err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			return errors.New("更新事务目录异常，请先恢复更新后再覆盖安装")
		}
		base := filepath.Join("data/state/updates/transactions", entry.Name())
		if _, err := root.Stat(filepath.Join(base, "committed")); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		backup, err := root.Open(filepath.Join(base, "backup"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		files, readErr := backup.ReadDir(1)
		closeErr := backup.Close()
		if readErr != nil && !errors.Is(readErr, io.EOF) || closeErr != nil {
			return errors.Join(readErr, closeErr)
		}
		if len(files) > 0 {
			return fmt.Errorf("%w；上次更新的备份需要恢复", ErrUpdateActive)
		}
	}
	return nil
}
