package portable

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"time"
)

const renameWait = 250 * time.Millisecond
// 安全软件（Defender、360、火绒等）会在解压后逐个扫描新文件并短暂占用目录，
// 几百 MB 的程序目录可能要几十秒才扫完，所以等待时间要足够长。
var renameTimeout = 90 * time.Second

func checkDirectoryOperations(ctx context.Context, parent *os.Root) (err error) {
	probe := ".eduwork-check-" + rand.Text()
	if err = parent.Mkdir(probe, 0700); err != nil {
		return err
	}
	defer func() { err = errors.Join(err, parent.Remove(probe)) }()
	renamed := probe + "-renamed"
	if err = renameDirectory(ctx, parent, probe, renamed, nil); err != nil {
		return err
	}
	probe = renamed
	return nil
}

func renameDirectory(ctx context.Context, parent *os.Root, from, to string, progress Reporter) error {
	deadline := time.Now().Add(renameTimeout)
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Every attempt must refuse an existing destination, even if it appeared
		// during the wait. Windows directory rename also refuses replacement.
		if _, err := parent.Lstat(to); err == nil {
			return fmt.Errorf("目标目录已存在，不会覆盖：%s", to)
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		err := parent.Rename(from, to)
		if err == nil {
			return nil
		}
		remaining := time.Until(deadline)
		if !transientRenameError(err) || remaining <= 0 {
			return err
		}
		if attempt == 0 {
			report(progress, 98, "正在等待安全软件扫描完成或安装目录解除占用（最长 90 秒）…")
		}
		timer := time.NewTimer(min(renameWait, remaining))
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
