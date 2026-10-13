package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

// LogEntry is one line of the log, kept in memory for the log screen.
type LogEntry struct {
	Seq   int    `json:"seq"`
	Time  int64  `json:"time"`
	Level string `json:"level"` // info, warn, error
	Msg   string `json:"msg"`
}

const logKeep = 3000

var (
	logMu   sync.Mutex
	logOut  io.Writer = os.Stdout
	logRing []LogEntry
	logSeq  int
	// LogPath is where the log is kept so problems can be reported even if
	// there is no console: %LOCALAPPDATA%\REASearch\REASearch.log. The
	// previous run's log is kept next to it as REASearch.old.log.
	LogPath = filepath.Join(dataDir(), "REASearch.log")
)

func initLog() {
	os.MkdirAll(dataDir(), 0o755)
	old := strings.TrimSuffix(LogPath, ".log") + ".old.log"
	os.Remove(old)
	os.Rename(LogPath, old)
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

func logAt(level, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	now := time.Now()
	tag := ""
	switch level {
	case "warn":
		tag = "[경고] "
	case "error":
		tag = "[오류] "
	}
	logMu.Lock()
	defer logMu.Unlock()
	switch level {
	case "warn":
		logWarns++
	case "error":
		logErrs++
	}
	fmt.Fprintf(logOut, "%s %s%s\n", now.Format("2006-01-02 15:04:05"), tag, msg)
	logSeq++
	logRing = append(logRing, LogEntry{Seq: logSeq, Time: now.Unix(), Level: level, Msg: msg})
	if len(logRing) > logKeep+logKeep/4 {
		logRing = append([]LogEntry{}, logRing[len(logRing)-logKeep:]...)
	}
}

func logf(format string, args ...any)   { logAt("info", format, args...) }
func warnf(format string, args ...any)  { logAt("warn", format, args...) }
func errorf(format string, args ...any) { logAt("error", format, args...) }

var logWarns, logErrs int

// logWarnCount is the number of warnings and errors so far, for the badge
// on the status button.
func logWarnCount() int {
	logMu.Lock()
	defer logMu.Unlock()
	return logWarns + logErrs
}

// LogSince returns kept entries after seq (0 for all).
func LogSince(seq int) []LogEntry {
	logMu.Lock()
	defer logMu.Unlock()
	out := []LogEntry{}
	for _, e := range logRing {
		if e.Seq > seq {
			out = append(out, e)
		}
	}
	return out
}

// recoverLog turns a crash into a logged message and a message box, instead
// of the program vanishing with no explanation.
func recoverLog(where string) {
	if r := recover(); r != nil {
		errorf("프로그램 오류(%s): %v\n%s", where, r, debug.Stack())
		alert(fmt.Sprintf("REA Search 오류(%s): %v\n\n자세한 내용: %s", where, r, LogPath))
		os.Exit(2)
	}
}
