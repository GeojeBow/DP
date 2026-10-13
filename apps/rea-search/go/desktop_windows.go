//go:build windows

package main

// Desktop integration: a system-wide shortcut that brings up the search
// window, and starting with Windows.

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	procRegisterHotKey      = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey    = user32.NewProc("UnregisterHotKey")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procPeekMessageW        = user32.NewProc("PeekMessageW")
	procPostThreadMessageW  = user32.NewProc("PostThreadMessageW")
	procEnumWindows         = user32.NewProc("EnumWindows")
	procGetWindowTextW      = user32.NewProc("GetWindowTextW")
	procGetClassNameW       = user32.NewProc("GetClassNameW")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procIsIconic            = user32.NewProc("IsIconic")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procGetCurrentThreadId  = kernel32.NewProc("GetCurrentThreadId")

	advapi32            = syscall.NewLazyDLL("advapi32.dll")
	procRegOpenKeyExW   = advapi32.NewProc("RegOpenKeyExW")
	procRegSetValueExW  = advapi32.NewProc("RegSetValueExW")
	procRegDeleteValueW = advapi32.NewProc("RegDeleteValueW")
	procRegQueryValueEx = advapi32.NewProc("RegQueryValueExW")
	procRegCloseKey     = advapi32.NewProc("RegCloseKey")
)

const (
	modAlt, modCtrl, modShift, modWin, modNoRepeat = 1, 2, 4, 8, 0x4000
	wmHotkey                                       = 0x0312
	wmChangeHotkey                                 = 0x8000 + 1 // WM_APP + 1
)

var hotkeyKeys = map[string][2]uint32{
	"Ctrl+Alt+F":     {modCtrl | modAlt, 'F'},
	"Ctrl+Alt+S":     {modCtrl | modAlt, 'S'},
	"Ctrl+Alt+Space": {modCtrl | modAlt, 0x20},
	"Win+Shift+F":    {modWin | modShift, 'F'},
	"Ctrl+Shift+F12": {modCtrl | modShift, 0x7B},
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      [2]int32
	private uint32
}

type hotkeys struct {
	mu      sync.Mutex
	tid     uintptr
	pending string
	err     error
	ready   chan struct{}
}

// startHotkey registers spec ("off" for none) and calls onPress whenever it
// is pressed. The returned function changes the shortcut and reports
// whether Windows accepted it (another program may already own it).
func startHotkey(spec string, onPress func()) (func(string) error, error) {
	h := &hotkeys{pending: spec, ready: make(chan struct{})}
	result := make(chan error, 1)
	go func() {
		runtime.LockOSThread() // hotkey messages go to the registering thread
		var m msg
		procPeekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, 0) // create the queue
		tid, _, _ := procGetCurrentThreadId.Call()
		h.tid = tid
		apply := func() error {
			h.mu.Lock()
			spec := h.pending
			h.mu.Unlock()
			procUnregisterHotKey.Call(0, 1)
			if spec == "off" || spec == "" {
				return nil
			}
			k, ok := hotkeyKeys[spec]
			if !ok {
				return fmt.Errorf("알 수 없는 단축키: %s", spec)
			}
			if r, _, err := procRegisterHotKey.Call(0, 1, uintptr(k[0]|modNoRepeat), uintptr(k[1])); r == 0 {
				return fmt.Errorf("%s 단축키를 다른 프로그램이 쓰고 있습니다 (%v)", spec, err)
			}
			return nil
		}
		h.err = apply()
		if h.err != nil {
			warnf("%v", h.err)
		}
		close(h.ready)
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				return
			}
			switch m.message {
			case wmHotkey:
				go onPress()
			case wmChangeHotkey:
				err := apply()
				if err != nil {
					warnf("%v", err)
				}
				result <- err
			}
		}
	}()
	<-h.ready
	return func(spec string) error {
		h.mu.Lock()
		h.pending = spec
		h.mu.Unlock()
		if r, _, err := procPostThreadMessageW.Call(h.tid, wmChangeHotkey, 0, 0); r == 0 {
			return fmt.Errorf("단축키를 바꾸지 못했습니다: %v", err)
		}
		select {
		case err := <-result:
			return err
		case <-time.After(3 * time.Second):
			return errors.New("단축키를 바꾸지 못했습니다")
		}
	}, h.err
}

var (
	enumMu    sync.Mutex
	enumFound uintptr
	// created once: Windows callbacks made with NewCallback are never freed
	enumCB = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		buf := make([]uint16, 256)
		n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), 256)
		title := string(utf16.Decode(buf[:n]))
		n, _, _ = procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), 256)
		class := string(utf16.Decode(buf[:n]))
		if strings.HasPrefix(title, "REA Search") && strings.HasPrefix(class, "Chrome_WidgetWin") {
			enumFound = hwnd
			return 0
		}
		return 1
	})
)

// bringWindow restores and focuses an open search window. False if none.
func bringWindow() bool {
	if h := uiHwnd.Load(); h != 0 {
		if ic, _, _ := procIsIconic.Call(h); ic != 0 {
			procShowWindow.Call(h, 9) // SW_RESTORE
		}
		procSetForegroundWindow.Call(h)
		return true
	}
	enumMu.Lock()
	enumFound = 0
	procEnumWindows.Call(enumCB, 0)
	found := enumFound
	enumMu.Unlock()
	if found == 0 {
		return false
	}
	if ic, _, _ := procIsIconic.Call(found); ic != 0 {
		procShowWindow.Call(found, 9) // SW_RESTORE
	}
	procSetForegroundWindow.Call(found)
	return true
}

// ---- start with Windows ----

const (
	taskName = "REA Search"
	runKey   = `Software\Microsoft\Windows\CurrentVersion\Run`
	hkcu     = 0x80000001
)

func regRun(set *string, del bool) (bool, error) {
	var h syscall.Handle
	k, _ := syscall.UTF16PtrFromString(runKey)
	if r, _, _ := procRegOpenKeyExW.Call(hkcu, uintptr(unsafe.Pointer(k)), 0, 0x0001|0x0002, uintptr(unsafe.Pointer(&h))); r != 0 {
		return false, fmt.Errorf("레지스트리를 열 수 없습니다 (%d)", r)
	}
	defer procRegCloseKey.Call(uintptr(h))
	name, _ := syscall.UTF16PtrFromString("REASearch")
	switch {
	case set != nil:
		data, _ := syscall.UTF16FromString(*set)
		r, _, _ := procRegSetValueExW.Call(uintptr(h), uintptr(unsafe.Pointer(name)), 0, 1,
			uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)*2))
		if r != 0 {
			return false, fmt.Errorf("레지스트리에 쓸 수 없습니다 (%d)", r)
		}
		return true, nil
	case del:
		procRegDeleteValueW.Call(uintptr(h), uintptr(unsafe.Pointer(name)))
		return false, nil
	}
	r, _, _ := procRegQueryValueEx.Call(uintptr(h), uintptr(unsafe.Pointer(name)), 0, 0, 0, 0)
	return r == 0, nil
}

func hiddenCmd(name string, args ...string) *exec.Cmd {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return c
}

func taskExists() bool {
	return hiddenCmd("schtasks", "/Query", "/TN", taskName).Run() == nil
}

func xmlEsc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}

// autostart reports whether the program starts at sign-in, and how.
func autostart() (bool, string) {
	if taskExists() {
		return true, "작업 스케줄러 (관리자 권한, 빠른 색인)"
	}
	if on, _ := regRun(nil, false); on {
		return true, "시작 프로그램 (일반 권한)"
	}
	return false, ""
}

// setAutostart turns starting at sign-in on or off. With administrator
// rights a scheduled task starts it elevated without a UAC prompt each
// time; otherwise it is added to the user's startup programs.
func setAutostart(on bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if !on {
		if taskExists() {
			if out, err := hiddenCmd("schtasks", "/Delete", "/TN", taskName, "/F").CombinedOutput(); err != nil {
				return fmt.Errorf("작업을 지우지 못했습니다: %s", strings.TrimSpace(string(out)))
			}
		}
		regRun(nil, true)
		return nil
	}
	if !isAdmin() {
		v := quote(exe) + " --startup"
		_, err := regRun(&v, false)
		return err
	}
	user := os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME")
	xml := `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>REA Search: 로그인할 때 파일 색인을 시작합니다</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>` + xmlEsc(user) + `</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>` + xmlEsc(user) + `</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>` + xmlEsc(exe) + `</Command><Arguments>--startup --elevated</Arguments></Exec></Actions>
</Task>`
	u := utf16.Encode([]rune(xml))
	b := []byte{0xFF, 0xFE}
	for _, c := range u {
		b = append(b, byte(c), byte(c>>8))
	}
	p := filepath.Join(dataDir(), "autostart-task.xml")
	if err := os.WriteFile(p, b, 0o600); err != nil {
		return err
	}
	defer os.Remove(p)
	if out, err := hiddenCmd("schtasks", "/Create", "/TN", taskName, "/XML", p, "/F").CombinedOutput(); err != nil {
		return errors.New("작업 스케줄러에 등록하지 못했습니다: " + strings.TrimSpace(decodeOEM(out)))
	}
	regRun(nil, true)
	return nil
}

// decodeOEM turns console output (often CP949 on Korean Windows) into text.
func decodeOEM(b []byte) string {
	if s, err := decodeText(b, false); err == nil {
		return s
	}
	return string(b)
}
