//go:build !windows

package main

import "github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"

func applyWithWindow(pending string, pid int) error { return updater.ApplyPending(pending, pid) }
