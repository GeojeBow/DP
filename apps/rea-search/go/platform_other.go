//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func opener() string {
	if runtime.GOOS == "darwin" {
		return "open"
	}
	return "xdg-open"
}

func openPath(p string) error   { return exec.Command(opener(), p).Start() }
func revealPath(p string) error { return exec.Command(opener(), filepath.Dir(p)).Start() }
func openBrowser(u string) error {
	return exec.Command(opener(), u).Start()
}
func relaunchElevated() bool { return false }

func isAdminUser() bool { return os.Geteuid() == 0 }
