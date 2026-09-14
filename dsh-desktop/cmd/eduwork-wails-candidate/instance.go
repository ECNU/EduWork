package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// As in the 0.2 launcher, preserve an activation arriving before OnStartup.
type windowActivator struct {
	mu      sync.Mutex
	ctx     context.Context
	pending bool
	show    func(context.Context)
}

func (a *windowActivator) attach(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	pending := a.pending
	a.pending = false
	a.mu.Unlock()
	if pending {
		a.show(ctx)
	}
}

func (a *windowActivator) activate() {
	a.mu.Lock()
	ctx := a.ctx
	if ctx == nil {
		a.pending = true
	}
	a.mu.Unlock()
	if ctx != nil {
		a.show(ctx)
	}
}

// Resolve existing ancestors as well as absent leaf folders so a junction alias
// cannot start a second Host on an already-owned home.
func homeLockID(home string) (string, error) {
	absolute, err := filepath.Abs(home)
	if err != nil {
		return "", err
	}
	parent := absolute
	parts := []string{}
	for {
		canonical, err := filepath.EvalSymlinks(parent)
		if err == nil {
			for index := len(parts) - 1; index >= 0; index-- {
				canonical = filepath.Join(canonical, parts[index])
			}
			if runtime.GOOS == "windows" {
				canonical = strings.ToLower(canonical)
			}
			return fmt.Sprintf("%x", sha256.Sum256([]byte(canonical))), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		next := filepath.Dir(parent)
		if next == parent {
			return "", err
		}
		parts = append(parts, filepath.Base(parent))
		parent = next
	}
}
