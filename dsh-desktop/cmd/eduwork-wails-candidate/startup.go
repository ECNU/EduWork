package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/desktoptransport"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/productruntime/webviewruntime"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/tray"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Startup is a small bound controller for the loading/error page. It exposes no
// arbitrary process, file or credential operations to the renderer.
type Startup struct {
	mu      sync.Mutex
	handler http.Handler
	message string
	failure string
	config  string
	name    string
	logo    string
	busy    bool
	retry   func()
	quit    func()
	window  context.Context
}

// Own the dialog with the Wails window. The upstream out-of-process picker
// synthesizes Alt for foreground activation, leaving this shell in menu mode.
func (s *Startup) PickDirectory() (string, error) {
	s.mu.Lock()
	ctx := s.window
	ready := s.handler != nil
	s.mu.Unlock()
	if ctx == nil || !ready {
		return "", fmt.Errorf("客户端尚未就绪，请稍后重试")
	}
	return wr.OpenDirectoryDialog(ctx, wr.OpenDialogOptions{Title: "选择要导入的目录"})
}

func (s *Startup) Retry() {
	s.mu.Lock()
	fn := s.retry
	allowed := !s.busy && s.handler == nil
	s.mu.Unlock()
	if allowed && fn != nil {
		fn()
	}
}
func (s *Startup) Quit() {
	if s.quit != nil {
		s.quit()
	}
}
func (s *Startup) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	h := s.handler
	state := map[string]any{"ready": h != nil, "message": s.message, "error": s.failure, "config": s.config, "name": s.name, "logo": s.logo}
	s.mu.Unlock()
	if r.URL.Path == "/.eduwork-startup" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(state)
		return
	}
	if h != nil {
		h.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, startupHTML)
}

func runCandidateWindow(config candidateConfig, root, node, host, product, home, privateConfig, userConfig string, probe bool, readyFile string, exitAfter time.Duration) error {
	if userConfig == "" {
		userConfig = filepath.Join(root, "config", "eduwork.jsonc")
	}
	absolute, err := filepath.Abs(userConfig)
	if err != nil {
		return err
	}
	userConfig = absolute
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	// GUI launches reach Wails' single-instance redirect before the data lock.
	// The owner still locks before migration, scheduled updates or Host startup;
	// headless probes also acquire that same lock and cannot bypass it.
	var releaseHome func()
	var ownsHome atomic.Bool
	defer func() {
		if releaseHome != nil {
			releaseHome()
		}
	}()
	claimHome := func() (bool, error) {
		var err error
		releaseHome, err = acquireHomeLock(home)
		if err != nil {
			return false, err
		}
		ownsHome.Store(true)
		if config.Bridge && config.HealthFile == "" {
			state := filepath.Join(root, "data", "state")
			if err := updater.DiscardSupersededPending(state, config.ProductVersion); err != nil {
				return false, err
			}
			return updater.LaunchScheduledIfNeeded(state)
		}
		return false, nil
	}
	events := desktoptransport.NewEventBridge(nil)
	defer events.Close()
	s := &Startup{message: "正在准备本机工作环境…", config: userConfig, name: config.ProductName}
	if image, err := os.ReadFile(filepath.Join(root, "resources", "brand", "icon-256.png")); err == nil {
		s.logo = "data:image/png;base64," + base64.StdEncoding.EncodeToString(image)
	}
	stage := func(message string) {
		s.mu.Lock()
		s.message = message
		s.mu.Unlock()
		_ = bridgeHealth(config.HealthFile, "starting", message)
	}
	if probe {
		if launched, err := claimHome(); err != nil || launched {
			return err
		}
		r, e := prepareCandidate(ctx, config, root, node, host, product, home, privateConfig, userConfig, events, stage)
		if e != nil {
			return e
		}
		defer r.close()
		if e = bridgeHealth(config.HealthFile, "ready", ""); e != nil {
			return e
		}
		if readyFile != "" {
			if e = os.WriteFile(readyFile, append(r.ready, '\n'), 0600); e != nil {
				return e
			}
		}
		fmt.Println(string(r.ready))
		return nil
	}
	var group sync.WaitGroup
	var exiting atomic.Bool
	var active *candidateRuntime
	var trayController tray.Controller
	var trayMu sync.Mutex
	var ready atomic.Bool
	var hideToTray atomic.Bool
	var notice sync.Once
	var windowCtx context.Context
	activator := &windowActivator{show: func(c context.Context) {
		wr.WindowUnminimise(c)
		wr.WindowShow(c)
	}}
	defer func() {
		cancel()
		group.Wait()
		trayMu.Lock()
		if trayController != nil {
			_ = trayController.Close()
		}
		trayMu.Unlock()
		if active != nil {
			active.close()
		}
	}()
	requestExit := func() { exiting.Store(true); cancel(); wr.Quit(windowCtx) }
	s.quit = requestExit
	start := func() {
		s.mu.Lock()
		if s.busy || s.handler != nil || exiting.Load() || !ownsHome.Load() {
			s.mu.Unlock()
			return
		}
		s.busy = true
		s.failure = ""
		group.Add(1)
		s.mu.Unlock()
		go func() {
			defer group.Done()
			r, e := prepareCandidate(ctx, config, root, node, host, product, home, privateConfig, userConfig, events, stage)
			if e == nil && ctx.Err() != nil {
				r.close()
				e = ctx.Err()
			}
			if e != nil {
				s.mu.Lock()
				s.busy = false
				s.failure = e.Error()
				s.mu.Unlock()
				_ = os.MkdirAll(filepath.Join(home, "logs"), 0700)
				_ = os.WriteFile(filepath.Join(home, "logs", "startup-error.log"), []byte(e.Error()+"\n"), 0600)
				_ = bridgeHealth(config.HealthFile, "failed", e.Error())
				return
			}
			active = r
			name := r.profile.Desktop.ProductName
			if name == "" {
				name = config.ProductName
			}
			wr.WindowSetTitle(windowCtx, name)
			controller, e := tray.Start(tray.Options{Tooltip: name, IconPath: filepath.Join(root, "resources", "brand", "icon.ico"), OnAction: func(action tray.Action) {
				if action == tray.ActionExit {
					requestExit()
				} else {
					activator.activate()
					if action == tray.ActionCheckUpdates {
						if config.Updates != nil {
							go config.Updates.open()
						} else {
							go checkCandidateUpdates(windowCtx, node, host, userConfig, config.ProductVersion)
						}
					} else if script := trayActionScript(action); script != "" {
						wr.WindowExecJS(windowCtx, script)
					}
				}
			}})
			trayMu.Lock()
			trayController = controller
			trayMu.Unlock()
			hideToTray.Store(e == nil && r.profile.Desktop.CloseAction != "exit")
			if exiting.Load() {
				return
			}
			s.mu.Lock()
			s.name = name
			s.handler = r.media.Handler()
			s.busy = false
			s.mu.Unlock()
			ready.Store(true)
			_ = bridgeHealth(config.HealthFile, "ready", "")
			if readyFile != "" {
				_ = os.WriteFile(readyFile, append(r.ready, '\n'), 0600)
			}
		}()
	}
	s.retry = start
	webview := &windows.Options{WebviewUserDataPath: startupWebviewPath(home)}
	if config.Bridge {
		if installed, e := webviewruntime.Resolve(filepath.Join(root, "data")); e == nil {
			webview.WebviewBrowserPath = installed.Root
		}
	}
	instanceID, err := homeLockID(home)
	if err != nil {
		return err
	}
	return wails.Run(&options.App{
		Title: config.ProductName, Width: 1280, Height: 850, MinWidth: 800, MinHeight: 600,
		AssetServer: &assetserver.Options{Handler: s}, Bind: []interface{}{events, s},
		Windows: webview,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "eduwork-wails-" + instanceID,
			OnSecondInstanceLaunch: func(options.SecondInstanceData) { activator.activate() },
		},
		OnStartup: func(c context.Context) {
			windowCtx = c
			s.mu.Lock()
			s.window = c
			s.mu.Unlock()
			activator.attach(c)
			launched, claimError := claimHome()
			if claimError != nil {
				s.mu.Lock()
				s.failure = claimError.Error()
				s.mu.Unlock()
				_ = bridgeHealth(config.HealthFile, "failed", claimError.Error())
				return
			}
			if launched {
				requestExit()
				return
			}
			config.Updates, err = newBridgeUpdates(config, root, c, requestExit)
			if err != nil {
				s.mu.Lock()
				s.failure = err.Error()
				s.mu.Unlock()
				_ = bridgeHealth(config.HealthFile, "failed", err.Error())
				return
			}
			start()
			if exitAfter > 0 {
				go func() {
					select {
					case <-time.After(exitAfter):
						requestExit()
					case <-ctx.Done():
					}
				}()
			}
		},
		OnBeforeClose: func(c context.Context) bool {
			if exiting.Load() || !ready.Load() || !hideToTray.Load() {
				exiting.Store(true)
				cancel()
				return false
			}
			wr.WindowHide(c)
			notice.Do(func() {
				trayMu.Lock()
				defer trayMu.Unlock()
				if trayController != nil {
					_ = trayController.Notify(s.name+" 仍在运行", "双击托盘图标重新打开；右键选择退出。")
				}
			})
			return true
		},
		OnShutdown: func(context.Context) { s.mu.Lock(); exiting.Store(true); s.mu.Unlock(); cancel() },
	})
}

const startupHTML = `<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;color:#313744;background:#faf8f4;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(580px,85vw);padding:30px;border:1px solid #e4d6ce;border-radius:16px;background:#fffdfa}progress{width:100%;accent-color:#536a9e}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f1;padding:15px;color:#9f2636;max-height:36vh;overflow:auto}button{padding:9px;margin-right:12px}code{overflow-wrap:anywhere;font-size:12px}</style><div class="card"><h2 style="display:flex;align-items:center;gap:12px"><img id="logo" alt="" width="40" height="40" hidden><span id="title">正在启动 EduWork</span></h2><p id="stage">正在准备本机工作环境…</p><progress id="progress"></progress><pre id="error" hidden></pre><p>配置文件：<code id="config"></code></p><div id="actions" hidden><button onclick="window.go.main.Startup.Retry()">修正后重试</button><button onclick="window.go.main.Startup.Quit()">退出</button></div></div><script>async function poll(){try{let s=await(await fetch('/.eduwork-startup')).json();if(s.ready){location.replace('/');return}if(s.logo){document.getElementById('logo').src=s.logo;document.getElementById('logo').hidden=false;}document.getElementById('title').textContent=(s.error?'暂时未能启动 ':'正在启动 ')+s.name;document.getElementById('stage').textContent=s.error?'修正问题后重试；原有配置和历史数据不会被重置。':s.message;document.getElementById('config').textContent=s.config;document.getElementById('error').hidden=!s.error;document.getElementById('error').textContent=s.error;document.getElementById('actions').hidden=!s.error;document.getElementById('progress').hidden=!!s.error;}catch{}setTimeout(poll,350)}poll()</script>`
