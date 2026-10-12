// Package electronaccess grants the Windows sandbox read access to Electron's
// runtime, without inheriting permissions into configuration or user data.
package electronaccess

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var runtimeFiles = []string{
	"EduWork-Electron.exe", "icudtl.dat", "snapshot_blob.bin", "v8_context_snapshot.bin",
	"resources.pak", "chrome_100_percent.pak", "chrome_200_percent.pak",
	"d3dcompiler_47.dll", "ffmpeg.dll", "libEGL.dll", "libGLESv2.dll",
	"vulkan-1.dll", "vk_swiftshader.dll", "vk_swiftshader_icd.json", "dxil.dll", "dxcompiler.dll",
}

var localeFile = regexp.MustCompile(`^[A-Za-z0-9_-]+\.pak$`)

func runtimePaths(root string) ([]string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if filepath.Dir(root) == root {
		return nil, fmt.Errorf("Electron installation must not be a drive root")
	}
	paths := []string{root}
	for _, name := range runtimeFiles {
		path := filepath.Join(root, name)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) && name != "EduWork-Electron.exe" {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("not a regular runtime file: %s", path)
		}
		paths = append(paths, path)
	}
	locales := filepath.Join(root, "locales")
	info, err := os.Lstat(locales)
	if os.IsNotExist(err) {
		return paths, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("invalid locales directory: %s", locales)
	}
	entries, err := os.ReadDir(locales)
	if err != nil {
		return nil, err
	}
	paths = append(paths, locales)
	for _, entry := range entries {
		if !localeFile.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("invalid locale file: %s", entry.Name())
		}
		paths = append(paths, filepath.Join(locales, entry.Name()))
	}
	return paths, nil
}
