package portable

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/installguard"
)

// ExistingInstallation only recognizes the same Electron product and edition.
func ExistingInstallation(target string, id Identity) (string, error) {
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("安装位置必须是本地应用目录，不能是链接")
	}
	root, err := os.OpenRoot(target)
	if err != nil {
		return "", err
	}
	defer root.Close()
	m, err := installedManifest(root, id)
	if err != nil {
		return "", err
	}
	return m.Version, nil
}
func installedManifest(root *os.Root, id Identity) (Manifest, error) {
	var m Manifest
	f, err := root.Open("RELEASE-MANIFEST.json")
	if err != nil {
		return m, errors.New("此目录不是可识别的 EduWork 安装目录，请选择其他位置")
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxManifest+1))
	if err != nil {
		return m, err
	}
	if len(b) > maxManifest || json.Unmarshal(b, &m) != nil || m.SchemaVersion != 1 || m.Kind != "eduwork-portable-release" || m.Shell != "electron" || m.Platform != "windows-x64" || m.Distribution != id.Distribution || m.Version == "" {
		return m, errors.New("已有应用的版本或发行标识不匹配，不能覆盖安装")
	}
	seen := map[string]bool{}
	for _, f := range m.Files {
		k := strings.ToLower(f.Path)
		if !ValidPath(f.Path) || seen[k] {
			return m, errors.New("已有应用文件清单无效")
		}
		seen[k] = true
	}
	if !seen["eduwork-electron.exe"] || !seen["resources/app/eduwork.desktop.json"] {
		return m, errors.New("已有应用缺少安装标识")
	}
	var app struct{ Shell, Distribution string }
	b, err = root.ReadFile("resources/app/eduwork.desktop.json")
	if err != nil || json.Unmarshal(b, &app) != nil || app.Shell != "electron" || app.Distribution != id.Distribution {
		return m, errors.New("已有应用的发行标识不匹配")
	}
	return m, nil
}
func privatePath(name string) bool {
	first := strings.ToLower(strings.Split(name, "/")[0])
	return first == "data" || first == "config" || first == ".env" || strings.HasPrefix(first, ".env.")
}

// Replace verifies the entire new release in a sibling directory, then replaces
// only manifest-owned program files. Unknown files and private state stay put.
func (a *Archive) Replace(ctx context.Context, target string, progress Reporter) (result string, err error) {
	return a.ReplaceWithOptions(ctx, target, ReplaceOptions{}, progress)
}

type ReplaceOptions struct {
	CloseRunning bool // Requires explicit confirmation of possible unsaved data loss.
}

// CloseRunning may only be enabled after explicit confirmation. The same lease
// covers update admission, process shutdown, replacement and rollback.
func (a *Archive) ReplaceWithOptions(ctx context.Context, target string, options ReplaceOptions, progress Reporter) (result string, err error) {
	target, err = filepath.Abs(target)
	if err != nil {
		return "", err
	}
	release, err := acquireInstallationLock(target)
	if err != nil {
		return "", err
	}
	defer release()
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = installguard.CheckUpdateIdle(target); err != nil {
		return "", err
	}
	root, err := os.OpenRoot(target)
	if err != nil {
		return "", err
	}
	defer root.Close()
	previous, err := installedManifest(root, a.Identity)
	if err != nil {
		return "", err
	}
	if options.CloseRunning {
		if err = stopApplication(ctx, target); err != nil {
			return "", err
		}
	}
	if err = checkNotRunning(target); err != nil {
		return "", err
	}
	parent, base := filepath.Dir(target), filepath.Base(target)
	p, err := os.OpenRoot(parent)
	if err != nil {
		return "", err
	}
	defer p.Close()
	stage := ".eduwork-replace-" + rand.Text()
	stagePath := filepath.Join(parent, stage)
	if _, err = a.Extract(ctx, stagePath, func(v Progress) {
		if v.Percent >= 10 && v.Percent < 100 {
			percent := 10 + (v.Percent-10)*60/88
			report(progress, percent, fmt.Sprintf("正在解压并校验应用文件… %d%%", percent))
		} else if v.Percent < 10 {
			report(progress, v.Percent, v.Message)
		}
	}); err != nil {
		return "", err
	}
	committed := false
	defer func() {
		if e := p.RemoveAll(stage); e != nil {
			cleanupErr := fmt.Errorf("临时文件未能清理，可稍后手动删除 %s：%w", stagePath, e)
			if committed {
				warn(progress, cleanupErr.Error())
			} else {
				err = errors.Join(err, cleanupErr)
			}
		}
	}()
	// Recheck after extraction: application may have been opened while verifying.
	if err = checkNotRunning(target); err != nil {
		return "", err
	}
	units, err := replacementPlan(ctx, root, previous, a.Manifest, progress)
	if err != nil {
		return "", err
	}
	backup := ".eduwork-backup-" + rand.Text()
	if err = p.Mkdir(backup, 0700); err != nil {
		return "", err
	}
	var backed, installed []replacementUnit
	rollback := func(cause error) (string, error) {
		report(progress, 95, "正在恢复原有应用，请保持窗口打开…")
		var restore error
		for i := len(installed) - 1; i >= 0; i-- {
			unit := installed[i]
			name := filepath.Join(base, unit.name)
			if unit.dir {
				restore = errors.Join(restore, p.RemoveAll(name))
			} else {
				restore = errors.Join(restore, p.Remove(name))
			}
		}
		for i := len(backed) - 1; i >= 0; i-- {
			name := backed[i].name
			restore = errors.Join(restore, p.Rename(filepath.Join(backup, name), filepath.Join(base, name)))
		}
		if restore != nil {
			return "", errors.Join(cause, fmt.Errorf("旧版恢复未完成，备份保留在 %s：%w", filepath.Join(parent, backup), restore))
		}
		_ = p.RemoveAll(backup)
		return "", cause
	}
	report(progress, 80, "正在替换应用文件，保留配置和数据…")
	total, done := 0, 0
	for _, unit := range units {
		total += unit.files
	}
	for _, unit := range units {
		if e := ctx.Err(); e != nil {
			return rollback(e)
		}
		if e := installguard.CheckUpdateIdle(target); e != nil {
			return rollback(e)
		}
		name := unit.name
		if unit.exists {
			if e := p.MkdirAll(filepath.Dir(filepath.Join(backup, name)), 0700); e != nil {
				return rollback(e)
			}
			if e := p.Rename(filepath.Join(base, name), filepath.Join(backup, name)); e != nil {
				return rollback(fmt.Errorf("文件被占用或无法写入，请关闭 EduWork 后重试：%w", e))
			}
			backed = append(backed, unit)
		}
		if unit.next {
			if e := root.MkdirAll(filepath.Dir(name), 0755); e != nil {
				return rollback(e)
			}
			if e := p.Rename(filepath.Join(stage, name), filepath.Join(base, name)); e != nil {
				return rollback(e)
			}
			installed = append(installed, unit)
		}
		done += unit.files
		report(progress, 80+15*done/total, fmt.Sprintf("正在替换应用文件… %d/%d", done, total))
	}
	if e := ctx.Err(); e != nil {
		return rollback(e)
	}
	committed = true
	report(progress, 96, "正在清理旧版临时备份…")
	if e := p.RemoveAll(backup); e != nil {
		warn(progress, fmt.Sprintf("旧版临时备份未能清理，可稍后手动删除 %s：%v", filepath.Join(parent, backup), e))
	}
	report(progress, 100, "安装完成，原有配置和数据已保留。")
	return target, nil
}
