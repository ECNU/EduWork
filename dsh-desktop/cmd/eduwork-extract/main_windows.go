package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/portable"
)

var buildIdentity string
var identity portable.Identity

func unpack(ctx context.Context, target string, verifyOnly bool, report portable.Reporter) (string, error) {
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
	return a.Extract(ctx, target, report)
}

func main() {
	data, err := base64.StdEncoding.DecodeString(buildIdentity)
	if err != nil || json.Unmarshal(data, &identity) != nil {
		message(0, "安装程序配置无效，请重新下载。")
		return
	}
	target := flag.String("extract-to", "", "extract into a new directory without starting the application")
	verify := flag.Bool("verify", false, "verify the embedded archive without extracting")
	reportPath := flag.String("report", "", "write an exclusive JSON result file for automation")
	flag.Parse()
	if *verify || *target != "" {
		started := time.Now()
		result, err := unpack(context.Background(), *target, *verify, nil)
		r := map[string]any{"success": err == nil, "target": result, "identity": identity, "seconds": time.Since(started).Seconds()}
		if err != nil {
			r["error"] = err.Error()
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
