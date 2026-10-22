package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/portable"
)

var buildIdentity string
var identity portable.Identity

func unpack(ctx context.Context, target string, verifyOnly bool, report portable.Reporter) (string, error) {
	return unpackWithOverwrite(ctx, target, verifyOnly, false, report)
}

func unpackWithOverwrite(ctx context.Context, target string, verifyOnly, overwrite bool, report portable.Reporter) (string, error) {
	return unpackConfirmed(ctx, target, verifyOnly, overwrite, false, report)
}
func unpackConfirmed(ctx context.Context, target string, verifyOnly, overwrite, closeRunning bool, report portable.Reporter) (string, error) {
	name, err := os.Executable()
	if err != nil {
		return "", err
	}
	f, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	r, err := portable.Payload(f, identity.Bytes)
	if err != nil {
		return "", err
	}
	if err := portable.Verify(ctx, r, identity, report); err != nil {
		return "", err
	}
	a, err := portable.Inspect(r, identity)
	if err != nil {
		return "", err
	}
	if verifyOnly {
		return "", nil
	}
	if overwrite {
		return a.ReplaceWithOptions(ctx, target, portable.ReplaceOptions{CloseRunning: closeRunning}, report)
	}
	return a.Extract(ctx, target, report)
}

func main() {
	data, err := base64.StdEncoding.DecodeString(buildIdentity)
	if err != nil || json.Unmarshal(data, &identity) != nil {
		message(0, "安装程序配置无效，请重新下载。")
		return
	}
	target := flag.String("extract-to", "", "extract into a new directory without starting the application")
	overwrite := flag.Bool("overwrite", false, "replace a recognized installation while preserving user state")
	verify := flag.Bool("verify", false, "verify the embedded archive without extracting")
	reportPath := flag.String("report", "", "write an exclusive JSON result file for automation")
	flag.Parse()
	if *verify || *target != "" {
		started := time.Now()
		var stages []map[string]any
		var warnings []string
		lastPercent, lastPhase := -1, ""
		progress := func(p portable.Progress) {
			if p.Warning {
				warnings = append(warnings, p.Message)
				fmt.Fprintln(os.Stderr, p.Message)
				return
			}
			if *reportPath != "" {
				phase := strings.SplitN(p.Message, "…", 2)[0]
				if p.Percent != lastPercent || phase != lastPhase {
					stages = append(stages, map[string]any{"seconds": time.Since(started).Seconds(), "percent": p.Percent, "message": p.Message})
					lastPercent, lastPhase = p.Percent, phase
				}
			}
		}
		result, err := unpackWithOverwrite(context.Background(), *target, *verify, *overwrite, progress)
		r := map[string]any{"success": err == nil, "target": result, "identity": identity, "seconds": time.Since(started).Seconds(), "stages": stages}
		if err != nil {
			r["error"] = err.Error()
		}
		if len(warnings) > 0 {
			r["warnings"] = warnings
		}
		if *reportPath != "" {
			b, _ := json.MarshalIndent(r, "", "  ")
			f, e := os.OpenFile(*reportPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e == nil {
				_, e = f.Write(b)
				closeErr := f.Close()
				if e == nil {
					e = closeErr
				}
			}
			if e != nil {
				fmt.Fprintln(os.Stderr, e)
				os.Exit(2)
			}
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	runUI()
}
