package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/desktoptransport"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/nativevault"
	"github.com/pkg/browser"
)

type candidateRuntime struct {
	profile profileResult
	client  *desktoptransport.Client
	media   *desktoptransport.MediaCarrier
	cleanup []func()
	ready   []byte
}

func (r *candidateRuntime) close() {
	for i := len(r.cleanup) - 1; i >= 0; i-- {
		r.cleanup[i]()
	}
}
func prepareCandidate(ctx context.Context, config candidateConfig, root, node, host, product, home, privateConfig, userConfig string, events *desktoptransport.EventBridge, stage func(string)) (result *candidateRuntime, err error) {
	r := &candidateRuntime{}
	defer func() {
		if err != nil {
			r.close()
		}
	}()
	if config.ImportLegacy {
		stage("正在迁移旧版历史数据，原数据将保留…")
		command := exec.CommandContext(ctx, node, filepath.Join(host, "wails-migration.mjs"), root, config.Distribution, config.ProductVersion)
		hideProcess(command)
		if output, e := command.CombinedOutput(); e != nil {
			return nil, migrationFailure(e, output)
		}
	}
	stage("正在读取配置并准备本机运行环境…")
	args := []string{filepath.Join(host, "product-profile-cli.mjs"), "--product", product, "--home", home, "--shell", "wails", "--user-config", userConfig}
	if privateConfig != "" {
		absolute, e := filepath.Abs(privateConfig)
		if e != nil {
			return nil, e
		}
		args = append(args, "--private-config", absolute)
	}
	prepare := exec.CommandContext(ctx, node, args...)
	prepare.Dir = root
	var diagnostic bytes.Buffer
	prepare.Stderr = &diagnostic
	hideProcess(prepare)
	output, e := prepare.Output()
	if e != nil {
		return nil, fmt.Errorf("准备运行环境失败：%w\n%s", e, diagnostic.String())
	}
	if json.Unmarshal(output, &r.profile) != nil || !filepath.IsAbs(r.profile.Profile) {
		return nil, errors.New("invalid shared desktop profile result")
	}
	if e = os.MkdirAll(filepath.Join(home, "logs"), 0700); e != nil {
		return nil, e
	}
	log, e := os.OpenFile(filepath.Join(home, "logs", "desktop-host.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e != nil {
		return nil, e
	}
	r.cleanup = append(r.cleanup, func() { _ = log.Close() })
	startRecord, _ := json.Marshal(map[string]any{"shell": "wails", "productVersion": config.ProductVersion, "startedAt": time.Now().UTC().Format(time.RFC3339)})
	_ = os.WriteFile(filepath.Join(home, "logs", "desktop-start.json"), startRecord, 0600)
	store, e := nativevault.NewNamespacedStore(config.AppID)
	if e != nil {
		return nil, e
	}
	nativeKey, e := token()
	if e != nil {
		return nil, e
	}
	instanceKey, e := token()
	if e != nil {
		return nil, e
	}
	native, e := nativevault.StartNative(nativeKey, store)
	if e != nil {
		return nil, e
	}
	r.cleanup = append(r.cleanup, func() { _ = native.Close() })
	native.AttachOpenExternal(browser.OpenURL)
	native.AttachExtension("open-configuration", configurationHandler(userConfig, openConfigurationPath))
	native.AttachExtension("workbench", workbenchHandler(node, host, userConfig, config.ProductVersion, filepath.Join(home, "logs"), root, product, home, config.Updates))
	bootstrap := map[string]any{"schemaVersion": 1, "instanceCredential": instanceKey, "nativeBridge": map[string]string{"baseURL": native.URL, "token": nativeKey}}
	stage("正在启动模型、插件和工作区服务…")
	r.client, e = desktoptransport.Start(ctx, desktoptransport.Config{Node: node, Bridge: filepath.Join(host, "bridge.mjs"), Adapter: filepath.Join(host, "host-process.mjs"), Profile: r.profile.Profile, Bootstrap: bootstrap, AllowLinkedProfile: true, Env: envWith(r.profile.Environment), Log: log})
	if e != nil {
		return nil, e
	}
	r.cleanup = append(r.cleanup, func() {
		c, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		_ = r.client.Close(c)
	})
	stage("正在检查工作界面…")
	request, _ := http.NewRequestWithContext(ctx, "GET", "dsh-app://app/", nil)
	response, e := r.client.RoundTrip(request)
	if e != nil {
		return nil, e
	}
	index, e := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	response.Body.Close()
	if e != nil {
		return nil, e
	}
	if response.StatusCode != 200 || !strings.Contains(string(index), "__DSH_TRANSPORT__") {
		return nil, errors.New("official desktop index/transport probe failed")
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	desktoptransport.AttachEventClient(events, r.client)
	r.media, e = desktoptransport.StartMediaCarrier(r.client, events)
	if e != nil {
		return nil, e
	}
	r.cleanup = append(r.cleanup, r.media.Close)
	r.ready, _ = json.MarshalIndent(map[string]any{"schemaVersion": 1, "shell": "wails", "hostProtocol": r.client.Ready.ProtocolVersion, "dshVersion": r.client.Ready.DSHVersion, "indexStatus": response.StatusCode, "transport": "stdio-node-ipc", "webServer": false, "distribution": config.Distribution}, "", "  ")
	return r, nil
}
