package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"
)

var (
	logMu  sync.Mutex
	logOut io.Writer = os.Stdout
	// LogPath is where the log is kept so problems can be reported even if
	// the window closes: %TEMP%\REASearch.log
	LogPath = filepath.Join(os.TempDir(), "REASearch.log")
)

func initLog() {
	f, err := os.OpenFile(LogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err == nil {
		logOut = io.MultiWriter(os.Stdout, f)
	}
}

func logf(format string, args ...any) {
	logMu.Lock()
	defer logMu.Unlock()
	fmt.Fprintf(logOut, time.Now().Format("15:04:05 ")+format+"\n", args...)
}

// recoverLog turns a crash into a logged message and keeps the window open,
// instead of the console vanishing with no explanation.
func recoverLog(where string) {
	if r := recover(); r != nil {
		logf("오류(%s): %v\n%s", where, r, debug.Stack())
		logf("로그 파일: %s", LogPath)
		pause()
		os.Exit(2)
	}
}
