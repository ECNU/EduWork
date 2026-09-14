//go:build !windows

package main

import "os/exec"

func hideProcess(command *exec.Cmd) {}
