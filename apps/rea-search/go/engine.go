package main

// Engine owns the indexes and keeps them current:
//
//   - the main index: NTFS drives read from the MFT and kept live by the change
//     journal, or (without admin rights) local drives walked folder by folder
//   - one index per extra folder, e.g. network shares, re-walked on a schedule
//   - an on-disk cache of everything, so a restart loads in seconds and only
//     catches up on what changed while the program was closed
//   - the content index (cindex.go)

import (
	"bufio"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	compactAt   = 20000
	cacheVer    = 3
	mainTop     = 0 // NTFS keys: drive number << 48 | file id
	walkMainTop = 1 // local walk keys
	firstFolder = 2 // extra folder ids start here (key top byte)
	recentMax   = 2000
)

// ChangeEvent is one live change seen in the NTFS change journal.
type ChangeEvent struct {
	Key  uint64 `json:"key,string"`
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Dir  bool   `json:"dir"`
	Time int64  `json:"time"`
}

// watcher is implemented by the NTFS change-journal reader (Windows only).
type watcher interface {
	Poll(ix *Index) (int, error)
	Journals() map[string][2]int64
	Drain() []ChangeEvent
	Volumes() []VolumeInfo
}

// VolumeInfo describes one NTFS drive followed by the change journal.
type VolumeInfo struct {
	Letter  string `json:"letter"`
	No      int    `json:"-"`
	Journal int64  `json:"journal"` // next change-journal position
	Count   int    `json:"count"`
}

// FolderSource is an extra folder (often a network share) indexed by walking.
type FolderSource struct {
	ID    int     `json:"id"`
	Path  string  `json:"path"`
	Hours float64 `json:"hours"` // rescan interval
}

type source struct {
	FolderSource
	ix       *Index
	status   string
	scanning bool
	last     time.Time
	err      string
	secs     float64
	skips    ScanSkips
}

type Settings struct {
	Folders []FolderSource `json:"folders"`
	Hotkey  string         `json:"hotkey"` // "" = default, "off" = none
	// Admin asks for administrator rights at start for the fast NTFS index.
	// Off by default: on company PCs the request is a security prompt.
	Admin bool `json:"admin"`
}

// wantAdmin reads the Admin setting before the engine exists (at start,
// to decide whether to ask for administrator rights).
func wantAdmin() bool {
	var st Settings
	b, err := os.ReadFile(filepath.Join(dataDir(), "settings.json"))
	return err == nil && json.Unmarshal(b, &st) == nil && st.Admin
}

func (e *Engine) Admin() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.settings.Admin
}

func (e *Engine) SetAdmin(on bool) {
	e.mu.Lock()
	e.settings.Admin = on
	e.saveSettingsLocked()
	e.mu.Unlock()
}

const defaultHotkey = "Ctrl+Alt+F"

func (e *Engine) Hotkey() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.settings.Hotkey == "" {
		return defaultHotkey
	}
	return e.settings.Hotkey
}

func (e *Engine) SetHotkey(h string) {
	e.mu.Lock()
	e.settings.Hotkey = h
	e.saveSettingsLocked()
	e.mu.Unlock()
}

type Engine struct {
	mu       sync.RWMutex
	main     *Index
	Mode     string // "loading", "ntfs" or "walk"
	Status   string
	Version  int // bumped on every change so the UI can refresh
	roots    []string
	watcher  watcher
	folders  []*source
	settings Settings
	dataDir  string
	recent   []ChangeEvent
	saved    int // Version at the last cache save
	mainLast time.Time
	started  time.Time
	mainFrom string  // "build" or "cache"
	mainSecs float64 // how long the last build or cache load took
	mainSkip ScanSkips
	saveAt   time.Time
	saveErr  string

	Content *CIndex
}

func dataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = filepath.Join(os.Getenv("HOME"), ".cache")
	}
	return filepath.Join(base, "REASearch")
}

func NewEngine(roots []string) *Engine {
	return NewEngineAt(roots, dataDir())
}

func NewEngineAt(roots []string, dir string) *Engine {
	os.MkdirAll(dir, 0o755)
	e := &Engine{main: emptyIndex, Mode: "loading", Status: "색인 준비 중...", roots: roots, dataDir: dir, started: time.Now()}
	e.loadSettings()
	for _, f := range e.settings.Folders {
		e.folders = append(e.folders, &source{FolderSource: f, ix: emptyIndex})
	}
	e.Content = OpenCIndex(filepath.Join(dir, "content"))
	return e
}

// ---- state access ----

func (e *Engine) View() *View {
	e.mu.RLock()
	defer e.mu.RUnlock()
	srcs := []*Index{e.main}
	top := uint64(mainTop)
	if e.Mode == "walk" {
		top = walkMainTop
	}
	tops := []uint64{top}
	for _, f := range e.folders {
		srcs = append(srcs, f.ix)
		tops = append(tops, uint64(f.ID))
	}
	return NewView(srcs, tops)
}

// Index returns the current view (used by the self-test).
func (e *Engine) Index() *View { return e.View() }

func (e *Engine) setStatus(s string) {
	if !strings.HasPrefix(s, "색인 중") && !strings.HasPrefix(s, "크기") {
		logf("%s", s)
	}
	e.mu.Lock()
	e.Status = s
	e.mu.Unlock()
}

func (e *Engine) bump() {
	e.mu.Lock()
	e.Version++
	e.mu.Unlock()
}

func (e *Engine) Info() (mode, status string, version, total int) {
	v := e.View()
	e.mu.RLock()
	mode, status, version = e.Mode, e.Status, e.Version
	e.mu.RUnlock()
	return mode, status, version, v.Len()
}

type FolderInfo struct {
	FolderSource
	Count    int    `json:"count"`
	Status   string `json:"status"`
	Scanning bool   `json:"scanning"`
	Last     int64  `json:"last"`
}

func (e *Engine) Folders() []FolderInfo {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := []FolderInfo{}
	for _, f := range e.folders {
		out = append(out, FolderInfo{f.FolderSource, f.ix.Len(), f.status, f.scanning, f.last.Unix()})
	}
	return out
}

func (e *Engine) Recent() []ChangeEvent {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]ChangeEvent, len(e.recent))
	for i, ev := range e.recent {
		out[len(e.recent)-1-i] = ev // newest first
	}
	return out
}

// ---- main index ----

func (e *Engine) Build() {
	start := time.Now()
	progress := func(n int, where string) { e.setStatus(fmt.Sprintf("색인 중... %d개 (%s)", n, where)) }
	var ix *Index
	mode := "walk"
	var w watcher
	var skips ScanSkips
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
		if err := walkInto(b, roots, walkMainTop<<56, progress); err != nil {
			warnf("색인할 폴더를 열 수 없습니다: %s", errText(err))
		}
		if b.Skips.Count > 0 {
			warnf("열 수 없는 폴더 %d개는 건너뛰었습니다 (예: %s). 색인 현황에서 목록을 볼 수 있습니다.", b.Skips.Count, b.Skips.Examples[0])
		}
		skips = b.Skips
		ix = b.Build(nil)
	}
	e.mu.Lock()
	e.mainFrom, e.mainSecs, e.mainSkip = "build", time.Since(start).Seconds(), skips
	e.main, e.Mode, e.watcher = ix, mode, w
	e.Version++
	e.mainLast = time.Now()
	e.Status = fmt.Sprintf("색인 완료: %d개, %.1f초", ix.Len(), time.Since(start).Seconds())
	e.mu.Unlock()
	logf("%s (%s)", e.Status, mode)
}

// Start loads the caches (or builds) and starts every background job.
func (e *Engine) Start() {
	if !e.loadMainCache() {
		e.Build()
		e.Save()
	}
	go e.watchLoop()
	go e.folderLoop()
	go e.metaFill()
	go e.saveLoop()
	go e.Content.Run(30 * time.Minute)
}

func (e *Engine) watchLoop() {
	defer recoverLog("watch")
	for range time.Tick(time.Second) {
		e.pollOnce()
		e.mu.RLock()
		walkDue := e.Mode == "walk" && len(e.roots) == 0 && time.Since(e.mainLast) > time.Hour
		e.mu.RUnlock()
		if walkDue { // no change journal without admin rights: re-walk hourly
			e.Build()
		}
	}
}

func (e *Engine) pollOnce() {
	e.mu.RLock()
	w, ix := e.watcher, e.main
	e.mu.RUnlock()
	if w == nil {
		return
	}
	n, err := w.Poll(ix)
	if err != nil {
		errorf("변경 감시 오류, 다시 색인합니다: %v", err)
		e.setStatus("변경 감시 오류, 다시 색인합니다")
		e.Build()
		return
	}
	evs := w.Drain()
	for _, ev := range evs {
		ix.Forget(ev.Key)
		if !ev.Dir && ev.Path != "" {
			e.Content.Notify(ev.Path)
		}
	}
	if n == 0 && len(evs) == 0 {
		return
	}
	if ix.OverlaySize() > compactAt {
		ix = ix.Compact()
	}
	e.mu.Lock()
	e.main = ix
	e.Version++
	e.recent = append(e.recent, evs...)
	if len(e.recent) > recentMax {
		e.recent = append([]ChangeEvent{}, e.recent[len(e.recent)-recentMax:]...)
	}
	e.mu.Unlock()
}

// metaFill reads size and date of every file in the background, so sorting
// and filtering by them is instant later. Results are kept in the cache.
func (e *Engine) metaFill() {
	defer recoverLog("meta")
	time.Sleep(3 * time.Second)
	v := e.View()
	e.mu.RLock()
	ix := e.main
	e.mu.RUnlock()
	ix.mu.RLock()
	var keys []uint64
	ix.metaMu.RLock()
	for i, k := range ix.keys {
		if !ix.dir[i] && ix.mod[i] < 0 {
			keys = append(keys, k)
		}
	}
	ix.metaMu.RUnlock()
	ix.mu.RUnlock()
	if len(keys) == 0 {
		return
	}
	start := time.Now()
	for i := 0; i < len(keys); i += 50000 {
		end := min(i+50000, len(keys))
		v.EnsureMeta(keys[i:end], nil)
		e.setStatus(fmt.Sprintf("크기·날짜 정보 읽는 중... %d / %d", end, len(keys)))
	}
	e.setStatus(fmt.Sprintf("크기·날짜 정보 준비 완료 (%d개, %.0f초)", len(keys), time.Since(start).Seconds()))
	e.bump()
	e.Save()
}

func (e *Engine) saveLoop() {
	defer recoverLog("save")
	for range time.Tick(10 * time.Minute) {
		e.mu.RLock()
		changed := e.Version != e.saved
		e.mu.RUnlock()
		if changed {
			e.Save()
		}
	}
}

// ---- extra folders (network shares etc.) ----

func (e *Engine) AddFolder(p string, hours float64) error {
	p = filepath.Clean(strings.TrimSpace(p))
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		return fmt.Errorf("폴더에 접근할 수 없습니다: %s", p)
	}
	if hours <= 0 {
		hours = 1
	}
	e.mu.Lock()
	used := map[int]bool{}
	for _, f := range e.folders {
		if strings.EqualFold(f.Path, p) {
			e.mu.Unlock()
			return fmt.Errorf("이미 추가된 폴더입니다")
		}
		used[f.ID] = true
	}
	id := firstFolder
	for used[id] {
		id++
	}
	if id > 255 {
		e.mu.Unlock()
		return fmt.Errorf("폴더를 더 추가할 수 없습니다")
	}
	src := &source{FolderSource: FolderSource{ID: id, Path: p, Hours: hours}, ix: emptyIndex}
	e.folders = append(e.folders, src)
	e.saveSettingsLocked()
	e.mu.Unlock()
	go e.scanFolder(src)
	return nil
}

func (e *Engine) RemoveFolder(id int) {
	e.mu.Lock()
	var keep []*source
	for _, f := range e.folders {
		if f.ID != id {
			keep = append(keep, f)
		}
	}
	e.folders = keep
	e.Version++
	e.saveSettingsLocked()
	e.mu.Unlock()
	os.Remove(filepath.Join(e.dataDir, fmt.Sprintf("names-%d.gob", id)))
}

func (e *Engine) RescanFolder(id int) {
	for _, f := range e.snapshotFolders() {
		if f.ID == id {
			go e.scanFolder(f)
		}
	}
}

func (e *Engine) scanFolder(src *source) {
	defer recoverLog("folder")
	e.mu.Lock()
	if src.scanning {
		e.mu.Unlock()
		return
	}
	src.scanning, src.status = true, "탐색 중..."
	e.mu.Unlock()
	start := time.Now()
	b := NewBuilder()
	logf("추가 폴더 탐색 시작: %s", src.Path)
	err := walkInto(b, []string{src.Path}, uint64(src.ID)<<56, func(n int, where string) {
		e.mu.Lock()
		src.status = fmt.Sprintf("탐색 중... %d개", n)
		e.mu.Unlock()
	})
	e.mu.Lock()
	src.scanning = false
	src.last = time.Now()
	if err != nil {
		src.status, src.err = "연결 안 됨: 이전 색인으로 검색합니다", errText(err)
		e.mu.Unlock()
		warnf("추가 폴더에 접근할 수 없습니다 %s: %s (이전 색인을 유지하고 나중에 다시 시도합니다)", src.Path, errText(err))
		return
	}
	src.ix = b.Build(nil)
	src.secs = time.Since(start).Seconds()
	src.skips = b.Skips
	src.status = fmt.Sprintf("%d개, %.0f초", src.ix.Len(), src.secs)
	src.err = ""
	logf("추가 폴더 탐색 완료: %s, %d개, %.1f초", src.Path, src.ix.Len(), src.secs)
	if b.Skips.Count > 0 {
		warnf("%s: 열 수 없는 폴더 %d개 (예: %s)", src.Path, b.Skips.Count, b.Skips.Examples[0])
	}
	e.Version++
	e.mu.Unlock()
	e.saveFolder(src)
}

func (e *Engine) folderLoop() {
	defer recoverLog("folders")
	for _, f := range e.snapshotFolders() {
		e.loadFolderCache(f)
	}
	e.bump()
	for {
		for _, f := range e.snapshotFolders() {
			e.mu.RLock()
			due := !f.scanning && time.Since(f.last) > time.Duration(f.Hours*float64(time.Hour))
			e.mu.RUnlock()
			if due {
				e.scanFolder(f)
			}
		}
		time.Sleep(30 * time.Second)
	}
}

func (e *Engine) snapshotFolders() []*source {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return append([]*source{}, e.folders...)
}

// ---- settings and cache ----

func (e *Engine) loadSettings() {
	b, err := os.ReadFile(filepath.Join(e.dataDir, "settings.json"))
	if err == nil {
		json.Unmarshal(b, &e.settings)
	}
	sort.Slice(e.settings.Folders, func(i, j int) bool { return e.settings.Folders[i].ID < e.settings.Folders[j].ID })
}

func (e *Engine) saveSettingsLocked() {
	e.settings.Folders = nil
	for _, f := range e.folders {
		e.settings.Folders = append(e.settings.Folders, f.FolderSource)
	}
	b, _ := json.MarshalIndent(e.settings, "", "  ")
	os.WriteFile(filepath.Join(e.dataDir, "settings.json"), b, 0o644)
}

type mainCache struct {
	Ver      int
	Mode     string
	Roots    []string
	Journals map[string][2]int64
	Index    *IndexState
}

type folderCache struct {
	Ver   int
	Path  string
	Last  int64
	Index *IndexState
}

func writeGob(path string, v any) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	err = gob.NewEncoder(w).Encode(v)
	if err == nil {
		err = w.Flush()
	}
	f.Close()
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func readGob(path string, v any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return gob.NewDecoder(bufio.NewReaderSize(f, 1<<20)).Decode(v)
}

// Save writes the main index (with journal positions) to disk.
func (e *Engine) Save() {
	e.mu.RLock()
	if e.Mode == "loading" {
		e.mu.RUnlock()
		return
	}
	c := mainCache{Ver: cacheVer, Mode: e.Mode, Roots: e.roots}
	ix, w, version := e.main, e.watcher, e.Version
	e.mu.RUnlock()
	if w != nil {
		c.Journals = w.Journals()
	}
	c.Index = ix.State()
	start := time.Now()
	if err := writeGob(filepath.Join(e.dataDir, "names-main.gob"), &c); err != nil {
		errorf("색인 캐시 저장 실패: %v", err)
		e.mu.Lock()
		e.saveErr = err.Error()
		e.mu.Unlock()
		return
	}
	e.mu.Lock()
	e.saved = version
	e.saveAt, e.saveErr = time.Now(), ""
	e.mu.Unlock()
	logf("캐시 저장: %d개, %.1f초", len(c.Index.Keys), time.Since(start).Seconds())
}

func (e *Engine) loadMainCache() bool {
	start := time.Now()
	var c mainCache
	err := readGob(filepath.Join(e.dataDir, "names-main.gob"), &c)
	switch {
	case os.IsNotExist(err):
		logf("저장된 색인이 없어 처음부터 색인합니다")
		return false
	case err != nil:
		warnf("저장된 색인을 읽을 수 없어 다시 색인합니다: %v", err)
		return false
	case c.Ver != cacheVer || c.Index == nil:
		logf("프로그램이 바뀌어 다시 색인합니다")
		return false
	case strings.Join(c.Roots, "|") != strings.Join(e.roots, "|"):
		logf("색인할 폴더가 바뀌어 다시 색인합니다")
		return false
	}
	ix := IndexFromState(c.Index)
	var w watcher
	if c.Mode == "ntfs" {
		var ok bool
		if w, ok = resumeNTFS(c.Journals, e.setStatus); !ok {
			logf("변경 기록을 이어 읽을 수 없어 다시 색인합니다")
			return false
		}
	} else if len(e.roots) == 0 && canNTFS() {
		logf("관리자 권한으로 실행되어 빠른 NTFS 방식으로 다시 색인합니다")
		return false // admin rights now: build the fast NTFS index instead
	}
	e.mu.Lock()
	e.mainFrom, e.mainSecs = "cache", time.Since(start).Seconds()
	e.main, e.Mode, e.watcher = ix, c.Mode, w
	e.Version++
	e.saved = e.Version
	e.mainLast = time.Now()
	if c.Mode == "walk" && len(e.roots) == 0 {
		e.mainLast = time.Time{} // refresh the walked drives soon
	}
	e.Status = fmt.Sprintf("캐시에서 %d개를 %.1f초 만에 불러왔습니다", ix.Len(), time.Since(start).Seconds())
	e.mu.Unlock()
	logf("%s", e.Status)
	if c.Mode == "ntfs" {
		e.pollOnce() // catch up on changes made while the program was closed
	}
	return true
}

func (e *Engine) saveFolder(src *source) {
	e.mu.RLock()
	c := folderCache{Ver: cacheVer, Path: src.Path, Last: src.last.Unix()}
	ix := src.ix
	e.mu.RUnlock()
	c.Index = ix.State()
	if err := writeGob(filepath.Join(e.dataDir, fmt.Sprintf("names-%d.gob", src.ID)), &c); err != nil {
		errorf("추가 폴더 색인 저장 실패 %s: %v", src.Path, err)
	}
}

func (e *Engine) loadFolderCache(src *source) {
	var c folderCache
	if err := readGob(filepath.Join(e.dataDir, fmt.Sprintf("names-%d.gob", src.ID)), &c); err != nil ||
		c.Ver != cacheVer || c.Index == nil || !strings.EqualFold(c.Path, src.Path) {
		return
	}
	ix := IndexFromState(c.Index)
	e.mu.Lock()
	src.ix = ix
	src.last = time.Unix(c.Last, 0)
	src.status = fmt.Sprintf("%d개 (저장된 색인)", ix.Len())
	e.mu.Unlock()
}
