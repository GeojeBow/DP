package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

const compactAt = 20000

// Engine owns the current index and keeps it up to date.
type Engine struct {
	mu      sync.RWMutex
	ix      *Index
	Mode    string // "loading", "ntfs" or "walk"
	Status  string
	roots   []string
	watcher watcher // nil unless NTFS
	Version int     // bumped on every change so the UI can refresh
}

// watcher is implemented by the NTFS change-journal reader (Windows only).
type watcher interface {
	Poll(ix *Index) (int, error)
}

func NewEngine(roots []string) *Engine {
	return &Engine{ix: NewBuilder().Build(nil), Mode: "loading", Status: "색인 준비 중...", roots: roots}
}

func (e *Engine) Index() *Index {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.ix
}

func (e *Engine) setStatus(s string) {
	if !strings.HasPrefix(s, "색인 중") {
		logf("%s", s)
	}
	e.mu.Lock()
	e.Status = s
	e.mu.Unlock()
}

func (e *Engine) Info() (mode, status string, version, total int) {
	e.mu.RLock()
	ix := e.ix
	mode, status, version = e.Mode, e.Status, e.Version
	e.mu.RUnlock()
	return mode, status, version, ix.Len()
}

func (e *Engine) Build() {
	start := time.Now()
	progress := func(n int, where string) { e.setStatus(fmt.Sprintf("색인 중... %d개 (%s)", n, where)) }
	var ix *Index
	mode := "walk"
	var w watcher
	if len(e.roots) == 0 {
		if nix, nw, ok := buildNTFS(progress, e.setStatus); ok {
			ix, w, mode = nix, nw, "ntfs"
		}
	}
	if ix == nil {
		roots := e.roots
		if len(roots) == 0 {
			roots = defaultRoots()
		}
		b := NewBuilder()
		walkInto(b, roots, progress)
		ix = b.Build(nil)
	}
	e.mu.Lock()
	e.ix, e.Mode, e.watcher = ix, mode, w
	e.Version++
	e.Status = fmt.Sprintf("색인 완료: %d개, %.1f초", ix.Len(), time.Since(start).Seconds())
	e.mu.Unlock()
	logf("%s (%s)", e.Status, mode)
}

// Watch applies change-journal records every second (NTFS mode only).
func (e *Engine) Watch() {
	defer recoverLog("watch")
	for range time.Tick(time.Second) {
		e.pollOnce()
	}
}

func (e *Engine) pollOnce() {
	e.mu.RLock()
	w, ix := e.watcher, e.ix
	e.mu.RUnlock()
	if w == nil {
		return
	}
	n, err := w.Poll(ix)
	if err != nil {
		logf("변경 감시 오류, 다시 색인합니다: %v", err)
		e.setStatus("변경 감시 오류, 다시 색인합니다: " + err.Error())
		e.Build()
		return
	}
	if n == 0 {
		return
	}
	if ix.OverlaySize() > compactAt {
		ix = ix.Compact()
	}
	e.mu.Lock()
	e.ix = ix
	e.Version++
	e.mu.Unlock()
}
