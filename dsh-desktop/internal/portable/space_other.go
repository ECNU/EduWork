//go:build !windows

package portable

import "golang.org/x/sys/unix"

func freeSpace(path string) (uint64, error) {
	var st unix.Statfs_t
	err := unix.Statfs(path, &st)
	return st.Bavail * uint64(st.Bsize), err
}
