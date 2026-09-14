package main

import (
	"context"
	"path/filepath"
	"testing"
)

func TestSecondLaunchRestoresOwnerIncludingStartupRace(t *testing.T) {
	calls := 0
	a := &windowActivator{show: func(context.Context) { calls++ }}
	a.activate()
	a.activate()
	if calls != 0 {
		t.Fatal("activated before window context was ready")
	}
	a.attach(context.Background())
	if calls != 1 {
		t.Fatal("pending activation was not restored")
	}
	a.activate()
	if calls != 2 {
		t.Fatal("second launch did not activate existing window")
	}
}

func TestHomeIsExclusiveBeforeProfileOrHostCreation(t *testing.T) {
	home := filepath.Join(t.TempDir(), "not-created", "home")
	release, err := acquireHomeLock(home)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireHomeLock(filepath.Join(home, ".")); err == nil {
		second()
		release()
		t.Fatal("second Host could acquire same data home")
	}
	other, err := acquireHomeLock(filepath.Join(home, "..", "other"))
	if err != nil {
		release()
		t.Fatal(err)
	}
	other()
	release()
	next, err := acquireHomeLock(home)
	if err != nil {
		t.Fatal("lock not released", err)
	}
	next()
}
