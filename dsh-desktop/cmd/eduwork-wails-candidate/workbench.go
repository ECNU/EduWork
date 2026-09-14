package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"time"
)

func workbenchHandler(node, host, config, version, logs, root, product, home string, bridges ...*bridgeUpdates) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			http.Error(w, "forbidden", 403)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		var body struct {
			Action string `json:"action"`
		}
		var extra any
		if decoder.Decode(&body) != nil || decoder.Decode(&extra) != io.EOF || (body.Action != "status" && body.Action != "check-updates" && body.Action != "diagnostics" && body.Action != "download-update" && body.Action != "schedule-update" && body.Action != "install-update" && body.Action != "use-stable-updates" && body.Action != "use-development-updates") {
			http.Error(w, "invalid action", 400)
			return
		}
		if len(bridges) > 0 && bridges[0] != nil && body.Action != "diagnostics" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(bridges[0].action(body.Action))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		updateJSON := ""
		if len(bridges) > 0 && bridges[0] != nil {
			encoded, _ := json.Marshal(bridges[0].action("status"))
			updateJSON = string(encoded)
		}
		command := exec.CommandContext(ctx, node, filepath.Join(host, "workbench-support.mjs"), body.Action, config, version, "wails", logs, root, product, home, updateJSON)
		hideProcess(command)
		result, err := command.Output()
		if err != nil || !json.Valid(result) {
			http.Error(w, "desktop action failed", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(result)
	})
}
