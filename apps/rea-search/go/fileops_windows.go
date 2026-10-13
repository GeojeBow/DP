package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	procSHFileOperationW = shell32.NewProc("SHFileOperationW")
	ole32                = syscall.NewLazyDLL("ole32.dll")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoUninitialize   = ole32.NewProc("CoUninitialize")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
	procCoTaskMemFree    = ole32.NewProc("CoTaskMemFree")
)

// SHFILEOPSTRUCTW (natural alignment on 64-bit Windows)
type shFileOpStruct struct {
	hwnd    uintptr
	wFunc   uint32
	pFrom   *uint16
	pTo     *uint16
	fFlags  uint16
	aborted int32
	nameMap uintptr
	title   *uint16
}

// doubleNull is a list of paths each ended by a NUL, plus a final NUL.
func doubleNull(paths []string) *uint16 {
	var u []uint16
	for _, p := range paths {
		u = append(u, utf16.Encode([]rune(p))...)
		u = append(u, 0)
	}
	u = append(u, 0)
	return &u[0]
}

// shellFileOp copies, moves or recycles with the Windows shell: its own
// progress window, "replace or skip" questions and Recycle Bin, and
// Ctrl+Z in Explorer undoes it.
func shellFileOp(op string, paths []string, dest string) (bool, error) {
	fn := map[string]uint32{"move": 1, "copy": 2, "trash": 3}[op]
	if fn == 0 {
		return false, fmt.Errorf("알 수 없는 작업")
	}
	const allowUndo = 0x40
	st := shFileOpStruct{hwnd: uiHwnd.Load(), wFunc: fn, pFrom: doubleNull(paths), fFlags: allowUndo}
	if dest != "" {
		st.pTo = doubleNull([]string{dest})
	}
	r, _, _ := procSHFileOperationW.Call(uintptr(unsafe.Pointer(&st)))
	if r != 0 && st.aborted == 0 {
		return false, fmt.Errorf("Windows가 작업을 끝내지 못했습니다 (코드 %#x)", r)
	}
	return st.aborted != 0, nil
}

type guid struct {
	d1     uint32
	d2, d3 uint16
	d4     [8]byte
}

var (
	clsidFileOpenDialog = guid{0xDC1C5A9C, 0xE88A, 0x4DDE, [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidIFileOpenDialog  = guid{0xD57C7288, 0xD4AD, 0x4768, [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
)

func comCall(obj uintptr, index int, args ...uintptr) uintptr {
	// obj points at the object, whose first word points at its method table
	self := *(**uintptr)(unsafe.Pointer(&obj))
	vtbl := *(**[64]uintptr)(unsafe.Pointer(self))
	fn := vtbl[index]
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// pickFolder shows the Windows folder picker (the Explorer-style dialog)
// over the search window. "" means the user cancelled.
func pickFolder(title string) (string, error) {
	type result struct {
		path string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		procCoInitializeEx.Call(0, 2) // apartment-threaded, as shell dialogs need
		defer procCoUninitialize.Call()
		var dlg uintptr
		if hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0, 1,
			uintptr(unsafe.Pointer(&iidIFileOpenDialog)), uintptr(unsafe.Pointer(&dlg))); hr != 0 {
			ch <- result{err: fmt.Errorf("폴더 선택 창을 열 수 없습니다 (%#x)", hr)}
			return
		}
		defer comCall(dlg, 2) // Release
		const pickFolders, forceFS = 0x20, 0x40
		var opts uint32
		comCall(dlg, 10, uintptr(unsafe.Pointer(&opts)))   // GetOptions
		comCall(dlg, 9, uintptr(opts|pickFolders|forceFS)) // SetOptions
		if title != "" {
			t, _ := syscall.UTF16PtrFromString(title)
			comCall(dlg, 17, uintptr(unsafe.Pointer(t))) // SetTitle
		}
		if hr := comCall(dlg, 3, uiHwnd.Load()); hr != 0 { // Show
			if uint32(hr) == 0x800704C7 { // cancelled
				ch <- result{}
				return
			}
			ch <- result{err: fmt.Errorf("폴더 선택 창 오류 (%#x)", hr)}
			return
		}
		var item uintptr
		if hr := comCall(dlg, 20, uintptr(unsafe.Pointer(&item))); hr != 0 || item == 0 { // GetResult
			ch <- result{err: fmt.Errorf("고른 폴더를 읽을 수 없습니다 (%#x)", hr)}
			return
		}
		defer comCall(item, 2)
		var name *uint16
		const fileSysPath = 0x80058000
		if hr := comCall(item, 5, fileSysPath, uintptr(unsafe.Pointer(&name))); hr != 0 || name == nil { // GetDisplayName
			ch <- result{err: fmt.Errorf("이 위치는 일반 폴더가 아닙니다")}
			return
		}
		defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(name)))
		ch <- result{path: utf16PtrToString(name)}
	}()
	r := <-ch
	return r.path, r.err
}

func utf16PtrToString(p *uint16) string {
	var u []uint16
	for ptr := unsafe.Pointer(p); ; ptr = unsafe.Add(ptr, 2) {
		c := *(*uint16)(ptr)
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return string(utf16.Decode(u))
}
