package main

import (
	"context"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"time"
)

func quitAfter(ctx context.Context, duration time.Duration) {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		runtime.Quit(ctx)
	case <-ctx.Done():
	}
}
