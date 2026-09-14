package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

func runBridgeApplyWindow(pending string, pid int) error {
	var mu sync.Mutex
	state := map[string]any{"message": "正在等待应用退出…", "percent": 0}
	busy := true
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/status" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			mu.Lock()
			defer mu.Unlock()
			_ = json.NewEncoder(w).Encode(state)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(updateHTML))
	})
	return wails.Run(&options.App{Title: "EduWork 更新", Width: 600, Height: 300, DisableResize: true, AssetServer: &assetserver.Options{Handler: handler},
		OnStartup: func(ctx context.Context) {
			go func() {
				err := updater.ApplyPendingWithProgress(pending, pid, func(p updater.ApplyProgress) {
					mu.Lock()
					state = map[string]any{"message": p.Message, "percent": p.Percent}
					mu.Unlock()
				})
				mu.Lock()
				busy = false
				if err != nil {
					state = map[string]any{"message": "更新未完成，原版本已恢复。可关闭此窗口。", "error": err.Error(), "percent": 100}
				}
				mu.Unlock()
				if err == nil {
					wr.Quit(ctx)
				}
			}()
		}, OnBeforeClose: func(context.Context) bool { mu.Lock(); defer mu.Unlock(); return busy }})
}

const updateHTML = `<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;margin:32px;background:#faf8f4;color:#313744}progress{width:100%;accent-color:#2575ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#9f2636}</style><h2>正在更新 EduWork</h2><p id="message">正在准备…</p><progress id="progress" max="100"></progress><pre id="error"></pre><script>async function poll(){try{const s=await(await fetch('/status')).json();document.getElementById('message').textContent=s.message;document.getElementById('progress').value=s.percent;document.getElementById('error').textContent=s.error||''}catch{}setTimeout(poll,400)}poll()</script>`
