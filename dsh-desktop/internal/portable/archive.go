// Package portable extracts an unchanged desktop release into a new directory.
// It deliberately does not implement updates or modify an existing installation.
package portable

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf16"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/electronaccess"
)

const Magic = "EDUWORK-SFX-v1\x00\x00"
const FooterSize = 32
const maxManifest = 32 << 20

type Identity struct {
	Product      string `json:"product"`
	Version      string `json:"version"`
	Distribution string `json:"distribution"`
	Root         string `json:"root"`
	SHA256       string `json:"sha256"`
	Bytes        int64  `json:"bytes"`
}
type File struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type Manifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	Kind          string `json:"kind"`
	Version       string `json:"version"`
	Distribution  string `json:"distribution"`
	Shell         string `json:"shell"`
	Platform      string `json:"platform"`
	Files         []File `json:"files"`
}
type Archive struct {
	Identity      Identity
	Manifest      Manifest
	Files         map[string]*zip.File
	ManifestBytes []byte
	Total         int64
}
type Progress struct {
	Percent int
	Message string
}
type Reporter func(Progress)

func report(fn Reporter, percent int, message string) {
	if fn != nil {
		fn(Progress{percent, message})
	}
}

// Payload uses a bounded section, so the original ZIP remains byte-for-byte intact.
func Payload(f *os.File, expectedBytes int64) (*io.SectionReader, error) {
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.Size() < FooterSize {
		return nil, errors.New("安装程序不完整，请重新下载")
	}
	footer := make([]byte, FooterSize)
	if _, err := f.ReadAt(footer, st.Size()-FooterSize); err != nil {
		return nil, err
	}
	start, size := binary.LittleEndian.Uint64(footer[16:24]), binary.LittleEndian.Uint64(footer[24:32])
	if string(footer[:16]) != Magic || size != uint64(expectedBytes) || size > uint64(st.Size()-FooterSize) || start != uint64(st.Size()-FooterSize)-size {
		return nil, errors.New("安装程序内容边界不正确，请重新下载")
	}
	return io.NewSectionReader(f, int64(start), int64(size)), nil
}

func ValidPath(name string) bool {
	if name == "" || name == "." || name != path.Clean(name) || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\:*?\"<>|\x00") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || len(utf16.Encode([]rune(part))) > 255 {
			return false
		}
		for _, c := range part {
			if c < 32 {
				return false
			}
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CONIN$" || base == "CONOUT$" {
			return false
		}
		if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9' {
			return false
		}
	}
	return true
}

func Inspect(reader io.ReaderAt, id Identity) (*Archive, error) {
	if id.Bytes <= 0 || !ValidPath(id.Root) || strings.Contains(id.Root, "/") || id.Product == "" || !validHash(id.SHA256) {
		return nil, errors.New("invalid extractor identity")
	}
	z, err := zip.NewReader(reader, id.Bytes)
	if err != nil {
		return nil, err
	}
	files := make(map[string]*zip.File)
	folded := make(map[string]bool)
	for _, item := range z.File {
		if !ValidPath(item.Name) || !item.Mode().IsRegular() || !strings.HasPrefix(item.Name, id.Root+"/") {
			return nil, fmt.Errorf("不支持的压缩包路径：%s", item.Name)
		}
		name := strings.TrimPrefix(item.Name, id.Root+"/")
		if folded[strings.ToLower(name)] {
			return nil, fmt.Errorf("重复的文件路径：%s", name)
		}
		folded[strings.ToLower(name)] = true
		files[name] = item
	}
	entry := files["RELEASE-MANIFEST.json"]
	if entry == nil || entry.UncompressedSize64 > maxManifest {
		return nil, errors.New("缺少有效的发行文件清单")
	}
	r, err := entry.Open()
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(r, maxManifest+1))
	closeErr := r.Close()
	if err != nil || closeErr != nil || len(data) > maxManifest {
		return nil, errors.New("无法读取发行文件清单")
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	if m.SchemaVersion != 1 || m.Kind != "eduwork-portable-release" || m.Version != id.Version || m.Distribution != id.Distribution || m.Platform != "windows-x64" || m.Shell != "electron" {
		return nil, errors.New("发行包与安装程序的版本或平台不匹配")
	}
	if len(m.Files) == 0 || len(m.Files)+1 != len(files) {
		return nil, errors.New("发行包文件数量与清单不符")
	}
	seen := map[string]bool{"release-manifest.json": true}
	total := int64(len(data))
	for _, f := range m.Files {
		if !ValidPath(f.Path) || f.Bytes < 0 || f.Bytes > 16<<30 || !validHash(f.SHA256) || seen[strings.ToLower(f.Path)] {
			return nil, fmt.Errorf("无效的清单条目：%s", f.Path)
		}
		seen[strings.ToLower(f.Path)] = true
		entry := files[f.Path]
		if entry == nil || entry.UncompressedSize64 != uint64(f.Bytes) {
			return nil, fmt.Errorf("文件缺失或大小不符：%s", f.Path)
		}
		total += f.Bytes
		if total > 64<<30 {
			return nil, errors.New("发行包过大")
		}
	}
	for _, required := range []string{"EduWork-Electron.exe", "resources/app/eduwork.desktop.json", "resources/update/EduWork-Updater.exe"} {
		if files[required] == nil {
			return nil, fmt.Errorf("缺少启动组件：%s", required)
		}
	}
	return &Archive{id, m, files, data, total}, nil
}
func validHash(s string) bool { b, e := hex.DecodeString(s); return e == nil && len(b) == sha256.Size }

type cancelReader struct {
	ctx context.Context
	r   io.Reader
}

func (r cancelReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(b)
}

type progressWriter struct {
	done, total int64
	last        int
	report      Reporter
}

func (w *progressWriter) Write(b []byte) (int, error) {
	w.done += int64(len(b))
	p := int(10 * w.done / w.total)
	if p != w.last {
		w.last = p
		report(w.report, p, "正在检查安装包完整性…")
	}
	return len(b), nil
}

func Verify(ctx context.Context, reader io.Reader, id Identity, progress Reporter) error {
	report(progress, 0, "正在检查安装包完整性…")
	h := sha256.New()
	w := &progressWriter{total: id.Bytes, last: -1, report: progress}
	n, err := io.Copy(io.MultiWriter(h, w), cancelReader{ctx, io.LimitReader(reader, id.Bytes+1)})
	if err != nil {
		return err
	}
	if n != id.Bytes || !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), id.SHA256) {
		return errors.New("安装包校验失败，请重新下载；现有应用未被修改")
	}
	return nil
}

// Extract creates a private sibling directory first and renames it only after
// every file has been checked. os.Root contains writes and cleanup within that
// directory, including when a path is unexpectedly replaced with a junction.
func (a *Archive) Extract(ctx context.Context, target string, progress Reporter) (result string, err error) {
	target, err = filepath.Abs(target)
	if err != nil {
		return "", err
	}
	base, parent := filepath.Base(target), filepath.Dir(target)
	if !ValidPath(base) || strings.Contains(base, "/") || len(utf16.Encode([]rune(filepath.Join(target, "EduWork-Electron.exe")))) >= 260 {
		return "", errors.New("请为应用选择较短的本地目录，以便内部工具正常运行")
	}
	if strings.HasPrefix(target, `\\`) {
		return "", errors.New("请选择本机磁盘目录")
	}
	p, err := os.OpenRoot(parent)
	if err != nil {
		return "", fmt.Errorf("无法打开上级目录，请通过“浏览”选择已有且可写的目录：%w", err)
	}
	defer p.Close()
	if _, e := p.Lstat(base); e == nil {
		return "", errors.New("目标目录已存在，请选择一个新目录；不会覆盖已有配置和数据")
	} else if !errors.Is(e, os.ErrNotExist) {
		return "", e
	}
	if err := checkDirectoryOperations(ctx, p); err != nil {
		return "", fmt.Errorf("无法在此位置创建、重命名或清理安装目录，请选择其他位置：%w", err)
	}
	free, err := freeSpace(parent)
	if err != nil {
		return "", fmt.Errorf("无法检查磁盘空间：%w", err)
	}
	if free < uint64(a.Total)+(64<<20) {
		return "", fmt.Errorf("磁盘空间不足，至少需要 %.1f GB 可用空间", float64(a.Total+(64<<20))/(1<<30))
	}
	stage := ".eduwork-unpack-" + rand.Text()
	if err = p.Mkdir(stage, 0700); err != nil {
		return "", fmt.Errorf("无法写入此目录，请选择有写入权限的位置：%w", err)
	}
	defer func() {
		if stage != "" {
			report(progress, 99, "正在清理本次未完成的安装…")
			if e := p.RemoveAll(stage); e != nil {
				err = errors.Join(err, fmt.Errorf("请手动删除本次临时目录 %s：%w", filepath.Join(parent, stage), e))
			} else if errors.Is(err, context.Canceled) {
				err = context.Canceled
			}
		}
	}()
	s, err := p.OpenRoot(stage)
	if err != nil {
		return "", err
	}
	defer func() { _ = s.Close() }()
	completed := int64(0)
	lastPercent := -1
	buffer := make([]byte, 1<<20)
	for _, f := range a.Manifest.Files {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if err := s.MkdirAll(filepath.Dir(f.Path), 0755); err != nil {
			return "", err
		}
		src, err := a.Files[f.Path].Open()
		if err != nil {
			return "", err
		}
		dst, err := s.OpenFile(f.Path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			_ = src.Close()
			return "", err
		}
		h := sha256.New()
		n, copyErr := io.CopyBuffer(io.MultiWriter(dst, h), cancelReader{ctx, src}, buffer)
		closeErr := errors.Join(dst.Close(), src.Close())
		if copyErr != nil || closeErr != nil {
			return "", fmt.Errorf("安装 %s 失败：%w", f.Path, errors.Join(copyErr, closeErr))
		}
		if n != f.Bytes || !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), f.SHA256) {
			return "", fmt.Errorf("文件校验失败：%s", f.Path)
		}
		completed += n
		percent := 10 + int(88*completed/a.Total)
		if percent != lastPercent {
			report(progress, percent, fmt.Sprintf("正在安装… %d%%", percent))
			lastPercent = percent
		}
	}
	if err := s.WriteFile("RELEASE-MANIFEST.json", a.ManifestBytes, 0644); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := electronaccess.Ensure(filepath.Join(parent, stage)); err != nil {
		return "", fmt.Errorf("无法准备程序运行权限：%w", err)
	}
	if err := s.Close(); err != nil {
		return "", err
	}
	// On Windows Rename does not replace an existing directory; never overwrite it.
	if _, e := p.Lstat(base); e == nil {
		return "", errors.New("目标目录已被其他程序创建，请更换目录重试")
	} else if !errors.Is(e, os.ErrNotExist) {
		return "", e
	}
	if err := renameDirectory(ctx, p, stage, base, progress); err != nil {
		return "", fmt.Errorf("安装文件已解压，但无法完成目录重命名；请检查占用程序、目录权限或安全软件记录（%s → %s）：%w", filepath.Join(parent, stage), target, err)
	}
	stage = ""
	report(progress, 100, "安装完成，可以启动应用了。")
	return target, nil
}
