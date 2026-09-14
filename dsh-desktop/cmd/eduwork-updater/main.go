// Small updater service for the Electron shell. It reuses the same verified
// downloader and transactional installer as the Go transition edition.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updatecontrol"
	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("expected serve or apply-update")
	}
	if args[0] == "apply-update" {
		f := flag.NewFlagSet("apply-update", flag.ContinueOnError)
		pending := f.String("pending", "", "")
		pid := f.Int("pid", 0, "")
		if err := f.Parse(args[1:]); err != nil {
			return err
		}
		if *pending == "" {
			return fmt.Errorf("missing pending update")
		}
		return applyWithWindow(*pending, *pid)
	}
	if args[0] != "serve" {
		return fmt.Errorf("unsupported mode")
	}
	f := flag.NewFlagSet("serve", flag.ContinueOnError)
	root := f.String("root", "", "")
	edition := f.String("edition", "", "")
	parent := f.Int("parent-pid", 0, "")
	if err := f.Parse(args[1:]); err != nil {
		return err
	}
	if !filepath.IsAbs(*root) || !filepath.IsAbs(*edition) || *parent <= 0 {
		return fmt.Errorf("invalid native startup arguments")
	}
	var identity struct {
		Shell          string `json:"shell"`
		ProductVersion string `json:"productVersion"`
	}
	bytes, err := os.ReadFile(filepath.Join(*root, "resources/app/eduwork.desktop.json"))
	if err != nil {
		return err
	}
	if json.Unmarshal(bytes, &identity) != nil || identity.Shell != "electron" {
		return fmt.Errorf("not an Electron installation")
	}
	state := filepath.Join(*root, "data/state")
	self, err := os.Executable()
	if err != nil {
		return err
	}
	var output sync.Mutex
	emit := func(value any) { output.Lock(); defer output.Unlock(); _ = json.NewEncoder(os.Stdout).Encode(value) }
	manager, err := updatecontrol.New(updatecontrol.Config{Version: identity.ProductVersion, EditionPath: *edition, StateDir: state, InstallDir: *root, RequiredShell: "electron", ExecutableName: "EduWork-Electron.exe", LaunchHelper: func() error { return updater.LaunchPendingHelperFor(state, self, *parent) }, RequestExit: func() {
		emit(map[string]any{"event": "quit-for-update"})
		time.Sleep(250 * time.Millisecond)
		os.Exit(0)
	}})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var workers sync.WaitGroup
	var busy atomic.Bool
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 16384)
	for scanner.Scan() {
		var request struct {
			ID     int    `json:"id"`
			Action string `json:"action"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			return fmt.Errorf("invalid service request")
		}
		var err error
		switch request.Action {
		case "use-stable-updates", "use-development-updates":
			policy := "stable"
			if request.Action == "use-development-updates" {
				policy = "development"
			}
			_, err = manager.SetPolicy(policy)
		case "status":
		case "check-updates", "download-update":
			if busy.CompareAndSwap(false, true) {
				workers.Add(1)
				action := request.Action
				go func() {
					defer workers.Done()
					defer busy.Store(false)
					if action == "check-updates" {
						check, c := context.WithTimeout(ctx, 25*time.Second)
						defer c()
						_, _ = manager.Check(check)
					} else {
						_, _ = manager.Download(ctx)
					}
				}()
			}
		case "schedule-update":
			_, err = manager.ScheduleNextStart()
		case "install-update":
			_, err = manager.InstallNow()
		case "apply-scheduled":
			if manager.Status().InstallOnNextStart {
				_, err = manager.InstallNow()
			}
		default:
			err = fmt.Errorf("unsupported desktop action")
		}
		result := map[string]any{"id": request.ID, "status": manager.Status()}
		if err != nil {
			result["error"] = err.Error()
		}
		emit(result)
	}
	cancel()
	workers.Wait()
	return scanner.Err()
}
