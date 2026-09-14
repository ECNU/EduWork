package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// The native side selects the two known paths; no caller-supplied path/command.
func configurationHandler(config string, open func(string, bool) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			http.Error(w, "forbidden", 403)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		var body struct {
			Target string `json:"target"`
		}
		var extra any
		if decoder.Decode(&body) != nil || decoder.Decode(&extra) != io.EOF || (body.Target != "config" && body.Target != "examples") {
			http.Error(w, "invalid configuration target", 400)
			return
		}
		path := config
		if body.Target == "examples" {
			path = filepath.Join(filepath.Dir(config), "examples")
		}
		info, err := os.Stat(path)
		if err == nil && info.IsDir() != (body.Target == "examples") {
			err = errors.New("unexpected configuration file type")
		}
		if err == nil {
			err = open(path, body.Target == "config")
		}
		if err != nil {
			http.Error(w, "configuration could not be opened", 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
