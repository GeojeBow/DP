package main

// The indexing status screen: what is indexed, how fresh it is, and what
// went wrong.

import (
	"os"
	"path/filepath"
	"runtime"
	"time"
)

type MainReport struct {
	Mode       string       `json:"mode"`
	Status     string       `json:"status"`
	Total      int          `json:"total"`
	From       string       `json:"from"`
	Secs       float64      `json:"secs"`
	Built      int64        `json:"built"`
	Roots      []string     `json:"roots"`
	Volumes    []VolumeInfo `json:"volumes"`
	Skips      ScanSkips    `json:"skips"`
	SavedAt    int64        `json:"savedAt"`
	SaveErr    string       `json:"saveErr"`
	CacheBytes int64        `json:"cacheBytes"`
	Pending    int          `json:"pending"` // live changes not yet merged
	Admin      bool         `json:"admin"`
}

type FolderReport struct {
	FolderInfo
	Err   string    `json:"err"`
	Secs  float64   `json:"secs"`
	Next  int64     `json:"next"`
	Skips ScanSkips `json:"skips"`
}

type Report struct {
	Main    MainReport     `json:"main"`
	Folders []FolderReport `json:"folders"`
	Content struct {
		CIndexStatus
		CIndexReport
	} `json:"content"`
	HeapMB   float64 `json:"heapMB"`
	SysMB    float64 `json:"sysMB"`
	Uptime   int64   `json:"uptime"`
	Recent   int     `json:"recent"`
	DataDir  string  `json:"dataDir"`
	LogPath  string  `json:"logPath"`
	Warnings int     `json:"warnings"`
	Errors   int     `json:"errors"`
}

func (e *Engine) Report() Report {
	var r Report
	e.mu.RLock()
	ix, w := e.main, e.watcher
	r.Main = MainReport{Mode: e.Mode, Status: e.Status, From: e.mainFrom, Secs: e.mainSecs, Built: e.mainLast.Unix(),
		Roots: e.roots, Skips: e.mainSkip, SaveErr: e.saveErr, Admin: isAdminUser()}
	if !e.saveAt.IsZero() {
		r.Main.SavedAt = e.saveAt.Unix()
	}
	if e.mainLast.IsZero() {
		r.Main.Built = 0
	}
	for _, f := range e.folders {
		fr := FolderReport{FolderInfo: FolderInfo{f.FolderSource, f.ix.Len(), f.status, f.scanning, f.last.Unix()},
			Err: f.err, Secs: f.secs, Skips: f.skips}
		if !f.last.IsZero() {
			fr.Next = f.last.Add(time.Duration(f.Hours * float64(time.Hour))).Unix()
		}
		r.Folders = append(r.Folders, fr)
	}
	r.Recent = len(e.recent)
	r.Uptime = int64(time.Since(e.started).Seconds())
	e.mu.RUnlock()
	if r.Folders == nil {
		r.Folders = []FolderReport{}
	}
	r.Main.Total = ix.Len()
	r.Main.Pending = ix.OverlaySize()
	if len(r.Main.Roots) == 0 && r.Main.Mode == "walk" {
		r.Main.Roots = defaultRoots()
	}
	if w != nil {
		r.Main.Volumes = w.Volumes()
		counts := map[int]int{}
		ix.mu.RLock()
		for _, k := range ix.keys {
			if k>>56 == mainTop {
				counts[int(k>>48)]++
			}
		}
		ix.mu.RUnlock()
		for i := range r.Main.Volumes {
			r.Main.Volumes[i].Count = counts[r.Main.Volumes[i].No]
		}
	}
	if st, err := os.Stat(filepath.Join(e.dataDir, "names-main.gob")); err == nil {
		r.Main.CacheBytes = st.Size()
	}
	r.Content.CIndexStatus = e.Content.Status()
	r.Content.CIndexReport = e.Content.Report()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	r.HeapMB, r.SysMB = float64(ms.HeapAlloc)/(1<<20), float64(ms.Sys)/(1<<20)
	r.DataDir, r.LogPath = e.dataDir, LogPath
	logMu.Lock()
	r.Warnings, r.Errors = logWarns, logErrs
	logMu.Unlock()
	return r
}
