//go:build windows

// pnpm-proxy-windows lets Node.js spawn the pnpm batch launcher through an
// actual executable. DSH's official release packer intentionally uses
// spawn("pnpm") without a shell; Windows cannot execute pnpm.cmd that way.
package main

import (
	"fmt"
	"os"
	"os/exec"
)

func main() {
	nodePath := os.Getenv("CHATECNU_PNPM_NODE")
	corepackScript := os.Getenv("CHATECNU_COREPACK_JS")
	pnpmVersion := os.Getenv("CHATECNU_PNPM_VERSION")
	if nodePath == "" || corepackScript == "" || pnpmVersion == "" {
		fmt.Fprintln(os.Stderr, "pnpm proxy environment is incomplete")
		os.Exit(2)
	}

	arguments := []string{corepackScript, "pnpm@" + pnpmVersion}
	arguments = append(arguments, os.Args[1:]...)
	command := exec.Command(nodePath, arguments...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
