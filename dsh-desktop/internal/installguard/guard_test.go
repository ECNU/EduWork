package installguard

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLeaseExcludesSameInstallationAndReleases(t *testing.T) {
	target := t.TempDir()
	release, err := Acquire(target)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if unexpected, err := Acquire(filepath.Join(target, ".")); !errors.Is(err, ErrBusy) {
		if unexpected != nil {
			unexpected()
		}
		t.Fatalf("second lease: %v", err)
	}
	other, err := Acquire(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	other()
	release()
	release() // Releasing twice must not close a subsequently recycled handle.
	next, err := Acquire(target)
	if err != nil {
		t.Fatal(err)
	}
	next()
}

func TestUpdateAndRecoveryEvidence(t *testing.T) {
	for _, state := range []string{"absent", "ready", "error", "applying", "rolling_back", "invalid", "backup", "committed"} {
		t.Run(state, func(t *testing.T) {
			target := t.TempDir()
			updates := filepath.Join(target, "data/state/updates")
			if err := os.MkdirAll(updates, 0700); err != nil {
				t.Fatal(err)
			}
			if state != "absent" && state != "backup" && state != "committed" {
				data := []byte(`{"state":"` + state + `"}`)
				if state == "invalid" {
					data = []byte(`{broken`)
				}
				if err := os.WriteFile(filepath.Join(updates, "pending-update.json"), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if state == "backup" || state == "committed" {
				base := filepath.Join(updates, "transactions/1.0.0")
				if err := os.MkdirAll(filepath.Join(base, "backup"), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(base, "backup/old.exe"), []byte("original"), 0600); err != nil {
					t.Fatal(err)
				}
				if state == "committed" {
					if err := os.WriteFile(filepath.Join(base, "committed"), nil, 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			err := CheckUpdateIdle(target)
			blocked := state == "applying" || state == "rolling_back" || state == "backup" || state == "invalid"
			if (err != nil) != blocked {
				t.Fatalf("state %s: %v", state, err)
			}
		})
	}
}
