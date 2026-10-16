//go:build !windows

package workspaceaccess

import "fmt"

func Check(path string) (Result, error)            { return Result{}, fmt.Errorf("Windows only") }
func Repair(path, expected string) (Result, error) { return Result{}, fmt.Errorf("Windows only") }
