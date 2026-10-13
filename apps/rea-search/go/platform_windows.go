//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
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

func fileCreated(st os.FileInfo) int64 {
	if d, ok := st.Sys().(*syscall.Win32FileAttributeData); ok {
		return d.CreationTime.Nanoseconds() / 1e9
	}
	return 0
}

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
)

// alert shows a message box (the app has no console window).
func alert(msg string) {
	logf("%s", msg)
	t, _ := syscall.UTF16PtrFromString("REA Search")
	m, _ := syscall.UTF16PtrFromString(msg)
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x30) // MB_ICONWARNING
}

// openAppWindow opens the search page as an app window (Edge or Chrome
// "--app" mode: no tabs or address bar), falling back to the default browser.
// Used when WebView2 is not available.
func openAppWindow(url string) error {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		cands = append(cands,
			filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(base, `Google\Chrome\Application\chrome.exe`))
	}
	for _, exe := range cands {
		if _, err := os.Stat(exe); err == nil {
			c := exec.Command(exe, "--app="+url, "--window-size=1280,820")
			if c.Start() == nil {
				return nil
			}
		}
	}
	return openBrowser(url)
}
