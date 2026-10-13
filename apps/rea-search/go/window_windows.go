package main

// The search window is this program's own window with the page inside it
// (Microsoft Edge WebView2, part of Windows 10/11), so the taskbar shows
// REA Search with its icon instead of Edge. Without the WebView2 runtime
// it falls back to an Edge/Chrome app window.

import (
	"path/filepath"
	"sync/atomic"
	"syscall"

	webview2 "github.com/jchv/go-webview2"
)

var (
	uiRunning atomic.Bool    // uiLoop is serving window requests
	uiBroken  atomic.Bool    // WebView2 could not start: use the browser
	uiHwnd    atomic.Uintptr // the open window, 0 if none
	uiReq     = make(chan string, 1)

	procGetDpiForSystem = syscall.NewLazyDLL("user32.dll").NewProc("GetDpiForSystem")
)

// openWindow shows the search page in our own window (or the browser).
func openWindow(url string) error {
	if uiRunning.Load() && !uiBroken.Load() {
		if uiHwnd.Load() != 0 {
			bringWindow()
			return nil
		}
		select {
		case uiReq <- url:
		default: // one is already on its way
		}
		return nil
	}
	return openAppWindow(url)
}

// uiLoop runs on the main thread (WebView2 needs the thread its COM
// apartment was set up on) and opens one window at a time.
func uiLoop() {
	uiRunning.Store(true)
	for url := range uiReq {
		if uiBroken.Load() || !showWebView(url) {
			uiBroken.Store(true)
			openAppWindow(url)
		}
	}
}

func showWebView(url string) bool {
	scale := uint(96)
	if procGetDpiForSystem.Find() == nil {
		if d, _, _ := procGetDpiForSystem.Call(); d >= 96 {
			scale = uint(d)
		}
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(dataDir(), "webview"),
		WindowOptions: webview2.WindowOptions{
			Title:  "REA Search",
			Width:  1280 * scale / 96,
			Height: 820 * scale / 96,
			IconId: 1, // the icon group in winres
			Center: true,
		},
	})
	if w == nil {
		warnf("WebView2 창을 만들 수 없어 Edge/Chrome 창으로 엽니다 (WebView2 런타임이 없을 수 있습니다)")
		return false
	}
	uiHwnd.Store(uintptr(w.Window()))
	w.Navigate(url)
	w.Run() // until the window is closed; the program keeps running
	uiHwnd.Store(0)
	return true
}
