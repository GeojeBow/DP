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
	// there is no console: %LOCALAPPDATA%\REASearch\REASearch.log
	LogPath = filepath.Join(dataDir(), "REASearch.log")
)

func initLog() {
	os.MkdirAll(dataDir(), 0o755)
	f, err := os.OpenFile(LogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err == nil {
		logOut = tee{f}
	}
}

// tee always writes the log file and copies to the console when there is
// one; a windowed build has no console, and that must not stop the file.
type tee struct{ f io.Writer }

func (t tee) Write(p []byte) (int, error) {
	os.Stdout.Write(p)
	return t.f.Write(p)
}

func logf(format string, args ...any) {
	logMu.Lock()
	defer logMu.Unlock()
	fmt.Fprintf(logOut, time.Now().Format("15:04:05 ")+format+"\n", args...)
}

// recoverLog turns a crash into a logged message and a message box, instead
// of the program vanishing with no explanation.
func recoverLog(where string) {
	if r := recover(); r != nil {
		logf("오류(%s): %v\n%s", where, r, debug.Stack())
		alert(fmt.Sprintf("REA Search 오류(%s): %v\n\n자세한 내용: %s", where, r, LogPath))
		os.Exit(2)
	}
}
