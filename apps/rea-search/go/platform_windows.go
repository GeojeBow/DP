//go:build windows

package main

import (
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

func shellCmd(cmdline string) error {
	c := exec.Command("cmd.exe")
	c.SysProcAttr = &syscall.SysProcAttr{CmdLine: cmdline, HideWindow: true}
	return c.Start()
}

func quote(p string) string { return `"` + strings.ReplaceAll(p, `"`, "") + `"` }

// openPath opens a file or folder with its default program.
func openPath(p string) error {
	c := exec.Command("explorer.exe")
	c.SysProcAttr = &syscall.SysProcAttr{CmdLine: "explorer.exe " + quote(p)}
	return c.Start()
}

// revealPath opens Explorer with the item selected.
func revealPath(p string) error {
	c := exec.Command("explorer.exe")
	c.SysProcAttr = &syscall.SysProcAttr{CmdLine: "explorer.exe /select," + quote(p)}
	return c.Start()
}

func openBrowser(url string) error {
	return shellCmd(`rundll32.exe url.dll,FileProtocolHandler ` + url)
}

// relaunchElevated asks Windows (UAC prompt) to restart this program as
// administrator so the fast NTFS indexer can be used. Returns true if the
// elevated copy was started and this one should exit.
func relaunchElevated() bool {
	if isAdmin() {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(exe)
	args, _ := syscall.UTF16PtrFromString("--elevated")
	r, _, _ := procShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(args)), 0, 1)
	return r > 32 // <= 32 means failed or the user said no
}

func isAdminUser() bool { return isAdmin() }
