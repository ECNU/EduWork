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
	"sort"
	"strings"
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
	target, err = filepath.Abs(target)
	if err != nil {
		return "", err
	}
	release, err := acquireInstallationLock(target)
	if err != nil {
		return "", err
	}
	defer release()
	root, err := os.OpenRoot(target)
	if err != nil {
		return "", err
	}
	defer root.Close()
	previous, err := installedManifest(root, a.Identity)
	if err != nil {
		return "", err
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
		if v.Percent < 100 {
			report(progress, v.Percent, v.Message)
		}
	}); err != nil {
		return "", err
	}
	defer func() {
		if e := p.RemoveAll(stage); e != nil {
			err = errors.Join(err, e)
		}
	}()
	// Recheck after extraction: application may have been opened while verifying.
	if err = checkNotRunning(target); err != nil {
		return "", err
	}
	old := map[string]bool{}
	next := map[string]bool{}
	names := map[string]bool{"RELEASE-MANIFEST.json": true}
	for _, f := range previous.Files {
		if !privatePath(f.Path) {
			old[strings.ToLower(f.Path)] = true
			names[f.Path] = true
		}
	}
	for _, f := range a.Manifest.Files {
		next[f.Path] = true
		names[f.Path] = true
	}
	next["RELEASE-MANIFEST.json"] = true
	old["release-manifest.json"] = true
	ordered := make([]string, 0, len(names))
	folded := map[string]string{}
	for name := range names {
		key := strings.ToLower(name)
		if other, ok := folded[key]; ok && other != name {
			return "", errors.New("新旧应用路径大小写冲突")
		}
		folded[key] = name
		ordered = append(ordered, name)
	}
	sort.Strings(ordered)
	// Preflight before changing any file; never follow junctions or overwrite
	// unrelated files merely because the new release uses the same filename.
	checkedParents := map[string]bool{}
	report(progress, 98, "正在检查现有应用文件…")
	for _, name := range ordered {
		if e := ctx.Err(); e != nil {
			return "", e
		}
		if err = plainParents(root, name, checkedParents); err != nil {
			return "", err
		}
		st, e := root.Lstat(name)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return "", e
		}
		if !st.Mode().IsRegular() {
			return "", fmt.Errorf("安装路径包含链接或非文件：%s", name)
		}
		if !privatePath(name) && !old[strings.ToLower(name)] {
			return "", fmt.Errorf("存在不属于旧版应用的同名文件，请另选目录：%s", name)
		}
	}
	backup := ".eduwork-backup-" + rand.Text()
	if err = p.Mkdir(backup, 0700); err != nil {
		return "", err
	}
	var backed, installed []string
	rollback := func(cause error) (string, error) {
		var restore error
		for i := len(installed) - 1; i >= 0; i-- {
			restore = errors.Join(restore, p.Remove(filepath.Join(base, installed[i])))
		}
		for i := len(backed) - 1; i >= 0; i-- {
			name := backed[i]
			restore = errors.Join(restore, p.Rename(filepath.Join(backup, name), filepath.Join(base, name)))
		}
		if restore != nil {
			return "", errors.Join(cause, fmt.Errorf("旧版恢复未完成，备份保留在 %s：%w", filepath.Join(parent, backup), restore))
		}
		_ = p.RemoveAll(backup)
		return "", cause
	}
	report(progress, 99, "正在替换应用文件，保留配置和数据…")
	for _, name := range ordered {
		if e := ctx.Err(); e != nil {
			return rollback(e)
		}
		if privatePath(name) {
			if _, e := root.Lstat(name); e == nil {
				continue
			}
		} else if _, e := root.Lstat(name); e == nil {
			if e = p.MkdirAll(filepath.Dir(filepath.Join(backup, name)), 0700); e != nil {
				return rollback(e)
			}
			if e = p.Rename(filepath.Join(base, name), filepath.Join(backup, name)); e != nil {
				return rollback(fmt.Errorf("文件被占用或无法写入，请关闭 EduWork 后重试：%w", e))
			}
			backed = append(backed, name)
		}
		if !next[name] {
			continue
		}
		if e := root.MkdirAll(filepath.Dir(name), 0755); e != nil {
			return rollback(e)
		}
		if e := p.Rename(filepath.Join(stage, name), filepath.Join(base, name)); e != nil {
			return rollback(e)
		}
		installed = append(installed, name)
	}
	if e := p.RemoveAll(backup); e != nil {
		report(progress, 100, "安装完成，旧版临时备份未能清理。")
	} else {
		report(progress, 100, "安装完成，原有配置和数据已保留。")
	}
	return target, nil
}
func plainParents(root *os.Root, name string, checked map[string]bool) error {
	parts := strings.Split(name, "/")
	for i := 1; i < len(parts); i++ {
		parent := strings.Join(parts[:i], "/")
		if checked[parent] {
			continue
		}
		st, e := root.Lstat(parent)
		if errors.Is(e, os.ErrNotExist) {
			return nil
		}
		if e != nil {
			return e
		}
		if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("安装路径包含链接或非目录：%s", name)
		}
		checked[parent] = true
	}
	return nil
}
