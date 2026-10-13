package main

import (
	"crypto/rand"
	"embed"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web/index.html web/manual.md
var webFS embed.FS

type row struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Folder string `json:"folder"`
	Parent string `json:"parent,omitempty"` // folder key, for "only this folder"
	Dir    bool   `json:"dir"`
	Size   int64  `json:"size"` // -1 unknown
	Mod    int64  `json:"mod"`  // unix seconds, 0 unknown
	Cat    string `json:"cat"`
	Group  int    `json:"group,omitempty"`
	Files  int32  `json:"files,omitempty"`  // folder size view: files inside
	Approx bool   `json:"approx,omitempty"` // folder size still being read
	GK     string `json:"gk,omitempty"`     // grouped view: the row's group
}

type cached struct {
	sig       string
	version   int
	keys      []uint64
	groups    map[uint64]int // duplicate groups
	fsizes    map[uint64]FolderTotal
	base      []uint64 // before the filter bar's narrowing
	sl        Slice
	facetOnce sync.Once
	fac       *SliceFacets
	glist     []GroupInfo       // grouped view: groups in order
	gk        map[uint64]string // grouped view: each key's group
	truncated bool
	err       string
}

type server struct {
	eng   *Engine
	token string
	host  string
	quit  func()

	mu   sync.Mutex
	last *cached

	jmu  sync.Mutex
	jobs map[string]*cjob
	dmu  sync.Mutex
	djob map[string]*dupJob

	url       string
	setHotkey func(string) error
	hotkeyErr string
	focusSeq  atomic.Int64 // bumped when the shortcut asks the page to focus search

	reindexing atomic.Bool

	elevated     bool        // started by the administrator request
	restartAdmin func() bool // restart as administrator; false if refused
}

// reindex rebuilds the main name index from scratch (status screen).
func (s *server) reindex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if !s.startReindex() {
		bad(w, "이미 다시 색인하는 중입니다")
		return
	}
	writeJSON(w, "ok")
}

func (s *server) startReindex() bool {
	if !s.reindexing.CompareAndSwap(false, true) {
		return false
	}
	logf("사용자 요청으로 이름 색인을 다시 만듭니다")
	go func() {
		defer s.reindexing.Store(false)
		defer recoverLog("reindex")
		s.eng.Build()
		s.eng.Save()
	}()
	return true
}

// summon brings up the search window (the global shortcut).
func (s *server) summon() {
	if !bringWindow() {
		openWindow(s.url)
	}
	s.focusSeq.Add(1)
}

func (s *server) desktop(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			Hotkey       *string `json:"hotkey"`
			Autostart    *bool   `json:"autostart"`
			Admin        *bool   `json:"admin"`
			RestartAdmin bool    `json:"restartAdmin"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			bad(w, "잘못된 요청")
			return
		}
		if req.Hotkey != nil {
			if _, ok := hotkeyKeys[*req.Hotkey]; !ok && *req.Hotkey != "off" {
				bad(w, "알 수 없는 단축키")
				return
			}
			s.eng.SetHotkey(*req.Hotkey)
			s.hotkeyErr = ""
			if s.setHotkey != nil {
				if err := s.setHotkey(*req.Hotkey); err != nil {
					s.hotkeyErr = err.Error()
				}
			}
		}
		if req.Autostart != nil {
			if err := setAutostart(*req.Autostart); err != nil {
				errorf("시작 시 실행 설정 실패: %v", err)
				bad(w, err.Error())
				return
			}
			logf("Windows 시작 시 실행: %v", *req.Autostart)
		}
		if req.Admin != nil {
			s.eng.SetAdmin(*req.Admin)
			logf("시작할 때 관리자 권한 요청: %v", *req.Admin)
		}
		if req.RestartAdmin {
			if isAdminUser() || s.restartAdmin == nil {
				bad(w, "이미 관리자 권한으로 실행 중입니다")
				return
			}
			if !s.restartAdmin() {
				bad(w, "관리자 권한 요청이 취소되었거나 허용되지 않았습니다")
				return
			}
		}
	}
	keys := []string{}
	for k := range hotkeyKeys {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	on, how := autostart()
	writeJSON(w, map[string]any{"hotkey": s.eng.Hotkey(), "hotkeys": keys, "hotkeyErr": s.hotkeyErr,
		"autostart": on, "autostartHow": how, "admin": isAdminUser(), "wantAdmin": s.eng.Admin(),
		"windows": runtime.GOOS == "windows"})
}

type dupJob struct {
	prog  DupProgress
	stop  atomic.Bool
	done  atomic.Bool
	start time.Time
}

// dupStart compares the contents of same-size files among the current
// results (name search and filters), in the background.
func (s *server) dupStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	p := parseSearch(r)
	p.dups = 0
	c := s.run(p)
	if c.err != "" {
		bad(w, c.err)
		return
	}
	keys := c.keys
	j := &dupJob{start: time.Now()}
	id := newToken()[:12]
	s.dmu.Lock()
	if s.djob == nil {
		s.djob = map[string]*dupJob{}
	}
	for k, old := range s.djob { // one comparison at a time
		old.stop.Store(true)
		if old.done.Load() {
			delete(s.djob, k)
		}
	}
	s.djob[id] = j
	s.dmu.Unlock()
	go func() {
		defer recoverLog("duplicates")
		HashDuplicates(s.eng.View(), keys, &j.prog, &j.stop)
		s.mu.Lock()
		s.last = nil // results with dups=2 depend on the new hashes
		s.mu.Unlock()
		if n := j.prog.Failed.Load(); n > 0 {
			warnf("중복 비교: 파일 %d개를 읽지 못했습니다", n)
		}
		j.done.Store(true)
	}()
	writeJSON(w, map[string]any{"id": id})
}

func (s *server) dupPoll(w http.ResponseWriter, r *http.Request) {
	s.dmu.Lock()
	j := s.djob[r.URL.Query().Get("id")]
	s.dmu.Unlock()
	if j == nil {
		bad(w, "작업을 찾을 수 없습니다")
		return
	}
	writeJSON(w, map[string]any{"pass": j.prog.Pass.Load(), "files": j.prog.Files.Load(), "filesDone": j.prog.FilesDone.Load(),
		"bytes": j.prog.Bytes.Load(), "bytesDone": j.prog.BytesDone.Load(), "failed": j.prog.Failed.Load(),
		"done": j.done.Load(), "stopped": j.stop.Load(), "ms": time.Since(j.start).Milliseconds()})
}

func (s *server) dupCancel(w http.ResponseWriter, r *http.Request) {
	s.dmu.Lock()
	if j := s.djob[r.URL.Query().Get("id")]; j != nil {
		j.stop.Store(true)
	}
	s.dmu.Unlock()
	writeJSON(w, "ok")
}

func newToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// guard: only our own page may call the API. Other web sites cannot read the
// per-run token, and the Host check blocks DNS-rebinding tricks.
func (s *server) guard(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Host != s.host || r.Header.Get("X-Token") != s.token {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		defer func() {
			if v := recover(); v != nil {
				logf("API 오류 %s: %v", r.URL.Path, v)
				http.Error(w, fmt.Sprint(v), http.StatusInternalServerError)
			}
		}()
		h(w, r)
	}
}

func (s *server) routes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("/", s.page)
	for path, h := range map[string]http.HandlerFunc{
		"/api/ping":           func(w http.ResponseWriter, r *http.Request) { writeJSON(w, "pong") },
		"/api/status":         s.status,
		"/api/search":         s.search,
		"/api/facets":         s.facets,
		"/api/fileop":         s.fileOp,
		"/api/pickfolder":     s.pickFolderHandler,
		"/api/summon":         func(w http.ResponseWriter, r *http.Request) { s.summon(); writeJSON(w, "ok") },
		"/api/schedule":       s.schedule,
		"/api/startindex":     s.startIndex,
		"/api/manual":         s.manual,
		"/api/open":           s.open,
		"/api/preview":        s.preview,
		"/api/raw":            s.raw,
		"/api/export":         s.export,
		"/api/recent":         s.recent,
		"/api/folders":        s.folders,
		"/api/cindex":         s.cindex,
		"/api/content/start":  s.contentStart,
		"/api/content/poll":   s.contentPoll,
		"/api/content/cancel": s.contentCancel,
		"/api/quit":           s.quitHandler,
		"/api/report":         func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.eng.Report()) },
		"/api/log":            s.logHandler,
		"/api/desktop":        s.desktop,
		"/api/reindex":        s.reindex,
		"/api/dups/start":     s.dupStart,
		"/api/dups/poll":      s.dupPoll,
		"/api/dups/cancel":    s.dupCancel,
		"/api/reveal":         s.revealHandler,
	} {
		m.HandleFunc(path, s.guard(h))
	}
	return m
}

type schedInfo struct {
	Target string   `json:"target"` // main, content, folder
	ID     int      `json:"id,omitempty"`
	Name   string   `json:"name"`
	Hours  float64  `json:"hours"`
	At     []string `json:"at"`
	Last   int64    `json:"last"` // unix, 0 never
	Next   int64    `json:"next"` // unix, 0 only when asked
	Busy   bool     `json:"busy"`
	Note   string   `json:"note,omitempty"`
}

// schedule lists and changes when each index is refreshed, and runs one now.
// startIndex is the "index when the program starts" switch.
func (s *server) startIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			On bool `json:"on"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			bad(w, "잘못된 요청")
			return
		}
		s.eng.SetIndexAtStart(req.On)
	}
	writeJSON(w, map[string]bool{"on": s.eng.IndexAtStart()})
}

func (s *server) schedule(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			Target string   `json:"target"`
			ID     int      `json:"id"`
			Hours  float64  `json:"hours"`
			At     []string `json:"at"`
			Now    bool     `json:"now"`
			Stop   bool     `json:"stop"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			bad(w, "잘못된 요청")
			return
		}
		if req.Stop {
			if req.Target == "content" {
				s.eng.Content.Stop()
			}
		} else if req.Now {
			switch req.Target {
			case "main":
				s.startReindex()
			case "content":
				s.eng.Content.walkSoon()
			case "folder":
				s.eng.RescanFolder(req.ID)
			}
		} else if err := s.eng.SetSchedule(req.Target, req.ID, Schedule{Hours: req.Hours, At: req.At}); err != nil {
			bad(w, err.Error())
			return
		}
		time.Sleep(100 * time.Millisecond) // let a started run show as busy
	}
	now := time.Now()
	unix := func(t time.Time) int64 {
		if t.IsZero() {
			return 0
		}
		return t.Unix()
	}
	var out []schedInfo
	mode, _, _, _ := s.eng.Info()
	ms := s.eng.MainSchedule()
	s.eng.mu.RLock()
	mainLast := s.eng.mainLast
	s.eng.mu.RUnlock()
	mi := schedInfo{Target: "main", Name: "이름 색인 (드라이브)", Hours: ms.Hours, At: ms.At, Last: unix(mainLast), Busy: s.reindexing.Load() || mode == "loading"}
	eff := ms
	if mode == "ntfs" {
		eff.Hours = 0
		mi.Note = "NTFS 실시간 감시로 바뀐 파일이 바로 반영되므로 주기는 쓰지 않습니다. 정한 시각에는 처음부터 다시 색인합니다."
	}
	mi.Next = unix(eff.Next(mainLast, now))
	out = append(out, mi)
	for _, f := range s.eng.Folders() {
		fs := f.FolderSource.schedule()
		last := time.Unix(f.Last, 0)
		if f.Last <= 0 {
			last = time.Time{}
		}
		out = append(out, schedInfo{Target: "folder", ID: f.ID, Name: f.Path, Hours: fs.Hours, At: fs.At,
			Last: unix(last), Next: unix(fs.Next(last, now)), Busy: f.Scanning})
	}
	cs := s.eng.ContentSchedule()
	cl := s.eng.Content.LastWalk()
	ci := schedInfo{Target: "content", Name: "내용 색인", Hours: cs.Hours, At: cs.At, Last: unix(cl), Next: unix(cs.Next(cl, now)), Busy: s.eng.Content.Status().Busy}
	if len(s.eng.Content.Status().Folders) == 0 {
		ci.Note = "내용 색인한 폴더가 아직 없습니다."
	}
	out = append(out, ci)
	for i := range out {
		if out[i].At == nil {
			out[i].At = []string{}
		}
	}
	writeJSON(w, out)
}

// manual is the user guide (a copy of README.md) for the in-app help.
func (s *server) manual(w http.ResponseWriter, r *http.Request) {
	b, _ := webFS.ReadFile("web/manual.md")
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write(b)
}

func (s *server) page(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" || r.Host != s.host {
		http.NotFound(w, r)
		return
	}
	b, _ := webFS.ReadFile("web/index.html")
	html := strings.Replace(string(b), "__TOKEN__", s.token, 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(html))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func bad(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	mode, status, version, total := s.eng.Info()
	writeJSON(w, map[string]any{"mode": mode, "status": status, "version": version, "total": total,
		"folders": s.eng.Folders(), "content": s.eng.Content.Status(), "recent": len(s.eng.Recent()),
		"focus": s.focusSeq.Load(), "warnings": logWarnCount()})
}

// ---- search ----

type searchParams struct {
	q     string
	opts  NameOpts
	f     Filter
	dups  int  // 1 same name and size, 2 same content
	fsize bool // folders by total size
	sl    Slice
	group string // folder, cat, ext, date, size
}

func num(r *http.Request, k string, def int64) int64 {
	v, err := strconv.ParseInt(r.URL.Query().Get(k), 10, 64)
	if err != nil {
		return def
	}
	return v
}

func parseSearch(r *http.Request) searchParams {
	g := r.URL.Query().Get
	on := func(k string) bool { return g(k) == "1" }
	p := searchParams{
		q:    g("q"),
		opts: NameOpts{Case: on("case"), Path: on("path"), Regex: on("regex")},
		f: Filter{MinSize: num(r, "min", -1), MaxSize: num(r, "max", -1),
			After: num(r, "after", 0), Before: num(r, "before", 0), Sort: g("sort"), Desc: on("desc")},
		dups:  int(num(r, "dups", 0)),
		fsize: on("fsize"),
		group: g("group"),
		sl: Slice{Within: g("within"), After: num(r, "sa", 0), Before: num(r, "sb", 0),
			MinSize: num(r, "smin", -1), MaxSize: num(r, "smax", -1)},
	}
	p.sl.Under, _ = parseKey(g("under"))
	list := func(k string) []string {
		if v := g(k); v != "" {
			return strings.Split(strings.ToLower(v), ",")
		}
		return nil
	}
	p.sl.Exts, p.sl.Cats = list("ext"), list("cat")
	if !p.opts.Regex {
		p.q = extractFilterTokens(p.q, &p.f, time.Now())
	}
	return p
}

func (p searchParams) sig() string {
	return fmt.Sprintf("%q|%v|%+v|%v|%v|%+v|%s", p.q, p.opts, p.f, p.dups, p.fsize, p.sl, p.group)
}

// run returns the full (cached) result list for the parameters.
func (s *server) run(p searchParams) *cached {
	_, _, version, _ := s.eng.Info()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last != nil && s.last.sig == p.sig() && s.last.version == version {
		return s.last
	}
	v := s.eng.View()
	c := &cached{sig: p.sig(), version: version}
	if p.opts.Regex {
		if _, err := ParseQueryOpts(p.q, p.opts); err != nil {
			c.err = "정규식 오류: " + err.Error()
			s.last = c
			return c
		}
	}
	keys := v.SearchOpts(p.q, p.opts)
	if p.fsize {
		c.fsizes = v.FolderSizes()
		f := p.f
		f.Category, f.Sort = "folder", ""
		keys, c.truncated = Apply(v, keys, f, nil)
		keys = append([]uint64{}, c.slice(v, keys, p.sl)...)
		sort.SliceStable(keys, func(i, j int) bool {
			a, b := c.fsizes[keys[i]], c.fsizes[keys[j]]
			if p.f.Sort == "name" {
				return false // keep name order
			}
			if p.f.Desc || p.f.Sort == "" {
				return a.Bytes > b.Bytes
			}
			return a.Bytes < b.Bytes
		})
		c.keys = keys
		s.last = c
		return c
	}
	keys, c.truncated = Apply(v, keys, p.f, nil)
	keys = c.slice(v, keys, p.sl)
	switch p.dups {
	case 1:
		keys, c.groups = Duplicates(v, keys, nil)
	case 2:
		keys, c.groups = DuplicatesByContent(v, keys)
	default:
		if p.group != "" {
			keys, c.glist, c.gk = GroupBy(v, keys, p.group)
		}
	}
	c.keys = keys
	s.last = c
	return c
}

// slice keeps the list before the filter bar's narrowing (for its counts)
// and returns the narrowed list.
func (c *cached) slice(v *View, keys []uint64, sl Slice) []uint64 {
	c.base, c.sl = keys, sl
	if !sl.active() {
		return keys
	}
	out, _ := ApplySlice(v, keys, sl, false)
	return out
}

// facets answers the filter bar: counts for every choice, subfolders and
// totals. It is asked for after the results are on screen, so a large
// result list never waits for it.
func (s *server) facets(w http.ResponseWriter, r *http.Request) {
	p := parseSearch(r)
	c := s.run(p)
	if c.err != "" {
		bad(w, c.err)
		return
	}
	c.facetOnce.Do(func() {
		_, c.fac = SliceAuto(s.eng.View(), c.base, c.sl)
	})
	writeJSON(w, c.fac)
}

func (s *server) rowFor(v *View, k uint64, groups map[uint64]int) (row, bool) {
	name, dir, ok := v.Node(k)
	if !ok {
		return row{}, false
	}
	rw := row{Key: strconv.FormatUint(k, 10), Name: name, Folder: v.Folder(k), Dir: dir, Size: -1, Cat: categoryOf(name, dir)}
	if m, ok := v.Meta(k); ok && m.ok {
		rw.Size, rw.Mod = m.size, m.mod
	}
	if par, ok := v.Parent(k); ok {
		rw.Parent = keyStr(par)
	}
	if groups != nil {
		rw.Group = groups[k]
	}
	return rw, true
}

func (s *server) search(w http.ResponseWriter, r *http.Request) {
	p := parseSearch(r)
	offset := int(num(r, "offset", 0))
	limit := int(num(r, "limit", 200))
	if limit <= 0 || limit > 2000 {
		limit = 200
	}
	start := time.Now()
	c := s.run(p)
	ms := float64(time.Since(start).Microseconds()) / 1000
	if c.err != "" {
		bad(w, c.err)
		return
	}
	v := s.eng.View()
	page := c.keys[min(offset, len(c.keys)):min(offset+limit, len(c.keys))]
	v.EnsureMeta(page, nil) // only what is on screen
	rows := []row{}
	for _, k := range page {
		if rw, ok := s.rowFor(v, k, c.groups); ok {
			if t, ok := c.fsizes[k]; ok && rw.Dir {
				rw.Size, rw.Files, rw.Approx = t.Bytes, t.Files, !t.Known
			}
			if c.gk != nil {
				rw.GK = c.gk[k]
			}
			rows = append(rows, rw)
		}
	}
	writeJSON(w, map[string]any{"total": len(c.keys), "ms": ms, "rows": rows, "groups": c.glist,
		"truncated": c.truncated, "version": c.version})
}

func (s *server) keyParam(r *http.Request) (uint64, string, bool) {
	k, err := strconv.ParseUint(r.URL.Query().Get("key"), 10, 64)
	if err != nil {
		return 0, "", false
	}
	p := s.eng.View().Path(k)
	return k, p, p != ""
}

// open acts on an indexed item by key (never on a path sent by the client).
func (s *server) open(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	_, p, ok := s.keyParam(r)
	if !ok {
		bad(w, "항목을 찾을 수 없습니다")
		return
	}
	var err error
	switch r.URL.Query().Get("how") {
	case "reveal":
		err = revealPath(p)
	case "path":
	default:
		err = openPath(p)
	}
	if err != nil {
		bad(w, err.Error())
		return
	}
	writeJSON(w, map[string]string{"path": p})
}

func (s *server) logHandler(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.Atoi(r.URL.Query().Get("since"))
	writeJSON(w, LogSince(since))
}

// revealHandler shows the log file, the data folder, or a file the content
// index could not read, in Explorer. Arbitrary paths are refused.
func (s *server) revealHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var err error
	switch r.URL.Query().Get("what") {
	case "log":
		err = revealPath(LogPath)
	case "data":
		err = openPath(s.eng.dataDir)
	case "fail":
		p := r.URL.Query().Get("path")
		if !s.eng.Content.IsFailed(p) {
			bad(w, "목록에 없는 파일입니다")
			return
		}
		err = revealPath(p)
	default:
		bad(w, "알 수 없는 요청")
		return
	}
	if err != nil {
		bad(w, err.Error())
		return
	}
	writeJSON(w, "ok")
}

// ---- preview ----

type previewLine struct {
	N    int   `json:"n"`
	Segs []Seg `json:"segs"`
}

func (s *server) preview(w http.ResponseWriter, r *http.Request) {
	k, p, ok := s.keyParam(r)
	if !ok {
		bad(w, "항목을 찾을 수 없습니다")
		return
	}
	v := s.eng.View()
	name, dir, _ := v.Node(k)
	out := map[string]any{"name": name, "path": p, "dir": dir, "cat": categoryOf(name, dir)}
	if st, err := os.Stat(p); err == nil {
		out["size"], out["mod"] = st.Size(), st.ModTime().Unix()
		out["created"] = fileCreated(st)
	}
	if dir {
		if ents, err := os.ReadDir(p); err == nil {
			var names []string
			for i, e := range ents {
				if i >= 200 {
					break
				}
				n := e.Name()
				if e.IsDir() {
					n += string(os.PathSeparator)
				}
				names = append(names, n)
			}
			out["kind"], out["children"], out["childCount"] = "folder", names, len(ents)
		}
		writeJSON(w, out)
		return
	}
	if categoryOf(name, false) == "image" && imageMime(name) != "" {
		out["kind"] = "image"
		writeJSON(w, out)
		return
	}
	text, err := ExtractText(p)
	if err != nil {
		out["kind"] = "none"
		writeJSON(w, out)
		return
	}
	out["kind"] = "text"
	cq, _ := ParseContentQuery(r.URL.Query().Get("cq"), CQOpts{Case: r.URL.Query().Get("ccase") == "1",
		Word: r.URL.Query().Get("cword") == "1", Regex: r.URL.Query().Get("cregex") == "1"})
	var lines []previewLine
	matches := []previewLine{}
	n := 0
	for len(text) > 0 && n < 100000 {
		n++
		var line string
		if i := strings.IndexByte(text, '\n'); i >= 0 {
			line, text = text[:i], text[i+1:]
		} else {
			line, text = text, ""
		}
		line = strings.TrimRight(line, "\r")
		var segs []Seg
		if cq != nil && !cq.Empty() {
			if sp := cq.spans(line); len(sp) > 0 {
				segs = cutSegs(line, sp, 400)
				if len(matches) < 300 {
					matches = append(matches, previewLine{n, segs})
				}
			}
		}
		if n <= 400 {
			if segs == nil {
				if len(line) > 2000 {
					line = line[:2000] + "…"
				}
				segs = []Seg{{T: strings.Map(cleanRune, line)}}
			}
			lines = append(lines, previewLine{n, segs})
		}
	}
	out["lines"], out["matches"], out["lineCount"] = lines, matches, n
	writeJSON(w, out)
}

func imageMime(name string) string {
	switch extOf(name) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "gif":
		return "image/gif"
	case "bmp":
		return "image/bmp"
	case "webp":
		return "image/webp"
	case "svg":
		return "image/svg+xml"
	case "ico":
		return "image/x-icon"
	}
	return ""
}

// raw serves an indexed image for the preview pane.
func (s *server) raw(w http.ResponseWriter, r *http.Request) {
	_, p, ok := s.keyParam(r)
	if !ok || imageMime(p) == "" {
		http.NotFound(w, r)
		return
	}
	st, err := os.Stat(p)
	if err != nil || st.Size() > 50<<20 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", imageMime(p))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	http.ServeFile(w, r, p)
}

// ---- export ----

func (s *server) export(w http.ResponseWriter, r *http.Request) {
	var keys []uint64
	var fsizes map[uint64]FolderTotal
	var groups map[uint64]int
	hits := map[uint64]int{}
	if id := r.URL.Query().Get("job"); id != "" {
		s.jmu.Lock()
		j := s.jobs[id]
		s.jmu.Unlock()
		if j == nil {
			bad(w, "내용 검색 결과가 없습니다")
			return
		}
		j.mu.Lock()
		for _, res := range j.results {
			k, _ := strconv.ParseUint(res.Key, 10, 64)
			keys = append(keys, k)
			hits[k] = res.Hits
		}
		j.mu.Unlock()
	} else {
		c := s.run(parseSearch(r))
		keys, fsizes, groups = c.keys, c.fsizes, c.groups
	}
	if len(keys) > 1000000 {
		keys = keys[:1000000]
	}
	v := s.eng.View()
	if len(keys) <= MetaLimit {
		v.EnsureMeta(keys, nil)
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="REASearch.csv"`)
	w.Write([]byte{0xEF, 0xBB, 0xBF}) // BOM so Excel reads Korean correctly
	cw := csv.NewWriter(w)
	head := []string{"이름", "폴더", "전체 경로", "크기(바이트)", "수정한 날짜", "유형"}
	if len(hits) > 0 {
		head = append(head, "일치한 줄 수")
	}
	if fsizes != nil {
		head = append(head, "안의 파일 수")
	}
	if groups != nil {
		head = append(head, "중복 묶음")
	}
	cw.Write(head)
	for _, k := range keys {
		rw, ok := s.rowFor(v, k, groups)
		if !ok {
			continue
		}
		size, mod := "", ""
		if rw.Size >= 0 && !rw.Dir {
			size = strconv.FormatInt(rw.Size, 10)
		}
		t, hasT := fsizes[k]
		if hasT {
			size = strconv.FormatInt(t.Bytes, 10)
		}
		if rw.Mod > 0 {
			mod = time.Unix(rw.Mod, 0).Format("2006-01-02 15:04:05")
		}
		rec := []string{rw.Name, rw.Folder, joinPath(rw.Folder, rw.Name), size, mod, catLabel[rw.Cat]}
		if len(hits) > 0 {
			rec = append(rec, strconv.Itoa(hits[k]))
		}
		if fsizes != nil {
			rec = append(rec, strconv.Itoa(int(t.Files)))
		}
		if groups != nil {
			rec = append(rec, strconv.Itoa(rw.Group))
		}
		cw.Write(rec)
	}
	cw.Flush()
}

var catLabel = map[string]string{"folder": "폴더", "doc": "문서", "image": "이미지", "video": "동영상", "audio": "음악",
	"archive": "압축", "exe": "실행 파일", "code": "코드", "other": "기타"}

// ---- recent changes, folders, content index settings ----

func (s *server) recent(w http.ResponseWriter, r *http.Request) {
	evs := s.eng.Recent()
	if len(evs) > 500 {
		evs = evs[:500]
	}
	writeJSON(w, map[string]any{"events": evs, "live": s.eng.Mode == "ntfs"})
}

type folderReq struct {
	Action string  `json:"action"`
	Path   string  `json:"path"`
	Hours  float64 `json:"hours"`
	ID     int     `json:"id"`
}

func readReq(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(v)
}

func (s *server) folders(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req folderReq
		if err := readReq(r, &req); err != nil {
			bad(w, "잘못된 요청")
			return
		}
		switch req.Action {
		case "add":
			if err := s.eng.AddFolder(req.Path, req.Hours); err != nil {
				bad(w, err.Error())
				return
			}
		case "remove":
			s.eng.RemoveFolder(req.ID)
		case "rescan":
			s.eng.RescanFolder(req.ID)
		}
	}
	writeJSON(w, s.eng.Folders())
}

func (s *server) cindex(w http.ResponseWriter, r *http.Request) {
	c := s.eng.Content
	if r.Method == http.MethodPost {
		var req folderReq
		if err := readReq(r, &req); err != nil {
			bad(w, "잘못된 요청")
			return
		}
		switch req.Action {
		case "add":
			if err := c.AddFolder(req.Path); err != nil {
				bad(w, err.Error())
				return
			}
		case "remove":
			c.RemoveFolder(req.Path)
		case "refresh":
			c.walkSoon()
		}
	}
	writeJSON(w, c.Status())
}

func (s *server) quitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, "bye")
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.quit()
	}()
}

// ---- content search jobs ----

type cres struct {
	Key     string    `json:"key"`
	Name    string    `json:"name"`
	Folder  string    `json:"folder"`
	Parent  string    `json:"parent,omitempty"`
	Size    int64     `json:"size"`
	Mod     int64     `json:"mod"`
	Cat     string    `json:"cat"`
	Hits    int       `json:"hits"`
	Snips   []Snippet `json:"snips"`
	Indexed bool      `json:"indexed"`
}

type cjob struct {
	id      string
	stop    atomic.Bool
	mu      sync.Mutex
	results []cres
	scanned int
	total   int
	done    bool
	start   time.Time
	ended   time.Time
	fails   map[string]int // why files could not be read, with counts
	failEx  []CFail        // a few examples
}

const (
	liveWarnAt   = 30000 // ask before reading this many unindexed files
	maxMatches   = 5000
	contentSnips = 3
)

type contentReq struct {
	CQ          string `json:"cq"`
	Case        bool   `json:"case"`
	Word        bool   `json:"word"`
	Regex       bool   `json:"regex"`
	Force       bool   `json:"force"`
	IndexedOnly bool   `json:"indexedOnly"`
	DocsOnly    bool   `json:"docsOnly"`   // only known document and text types
	SkipSystem  bool   `json:"skipSystem"` // leave out Windows, program and cache folders
}

// systemDirs are folders that hold program files rather than the user's
// documents; searching every file's contents skips them unless asked.
var systemDirs = []string{`\windows\`, `\windows.old\`, `\program files\`, `\program files (x86)\`, `\programdata\`,
	`\appdata\`, `\$recycle.bin\`, `\system volume information\`, `\node_modules\`, `\.git\`, `\$windows.~bt\`,
	`/proc/`, `/sys/`, `/usr/`, `/.cache/`, `/node_modules/`, `/.git/`}

func inSystemDir(p string) bool {
	lp := strings.ToLower(p)
	for _, d := range systemDirs {
		if strings.Contains(lp, d) {
			return true
		}
	}
	return false
}

func (s *server) contentStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req contentReq
	if err := readReq(r, &req); err != nil {
		bad(w, "잘못된 요청")
		return
	}
	cq, err := ParseContentQuery(req.CQ, CQOpts{Case: req.Case, Word: req.Word, Regex: req.Regex})
	if err != nil {
		bad(w, "정규식 오류: "+err.Error())
		return
	}
	if cq.Empty() {
		bad(w, "찾을 내용을 입력하세요")
		return
	}
	c := s.run(parseSearch(r)) // the name search and filters set the scope
	if c.err != "" {
		bad(w, c.err)
		return
	}
	v := s.eng.View()
	ci := s.eng.Content
	type item struct {
		key  uint64
		path string
		id   uint32
	}
	var indexed, live []item
	for _, k := range c.keys {
		name, dir, ok := v.Node(k)
		if !ok || dir {
			continue
		}
		kind := contentKind(name)
		if kind == "" || req.DocsOnly && kind == "sniff" {
			continue
		}
		p := v.Path(k)
		if req.SkipSystem && inSystemDir(p) {
			continue
		}
		if id, ok := ci.Lookup(p); ok {
			indexed = append(indexed, item{k, p, id})
		} else {
			live = append(live, item{k, p, 0})
		}
	}
	if req.IndexedOnly {
		live = nil
	}
	if len(live) > liveWarnAt && !req.Force {
		writeJSON(w, map[string]any{"warn": true, "indexed": len(indexed), "live": len(live)})
		return
	}
	// the index rules out most indexed files without opening them
	cands, narrowed := ci.Candidates(cq)
	var work []item
	skipped := 0
	for _, it := range indexed {
		if narrowed && !cands[it.id] {
			skipped++
			continue
		}
		work = append(work, it)
	}
	nIndexed := len(work)
	work = append(work, live...)

	j := &cjob{id: newToken()[:12], total: len(work) + skipped, scanned: skipped, start: time.Now()}
	s.jmu.Lock()
	if s.jobs == nil {
		s.jobs = map[string]*cjob{}
	}
	for id, old := range s.jobs { // keep only recent jobs
		old.stop.Store(true)
		if time.Since(old.start) > 10*time.Minute {
			delete(s.jobs, id)
		}
	}
	s.jobs[j.id] = j
	s.jmu.Unlock()

	go func() {
		defer recoverLog("content search")
		ch := make(chan int)
		var wg sync.WaitGroup
		for n := 0; n < runtime.NumCPU()*2; n++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range ch {
					it := work[i]
					text, err := ExtractText(it.path)
					var res *cres
					if err == nil {
						if ct := cq.prep(text); cq.Match(ct) {
							snips, hits := cq.Snippets(text, contentSnips)
							rw, _ := s.rowFor(v, it.key, nil)
							res = &cres{Key: rw.Key, Name: rw.Name, Folder: rw.Folder, Parent: rw.Parent, Size: rw.Size, Mod: rw.Mod,
								Cat: rw.Cat, Hits: hits, Snips: snips, Indexed: i < nIndexed}
						}
					}
					j.mu.Lock()
					j.scanned++
					if err != nil && !(err == errNotText && contentKind(it.path) == "sniff") {
						why := failReason(err)
						if j.fails == nil {
							j.fails = map[string]int{}
						}
						j.fails[why]++
						if len(j.failEx) < 200 {
							j.failEx = append(j.failEx, CFail{Path: it.path, Reason: why})
						}
					}
					if res != nil && len(j.results) < maxMatches {
						j.results = append(j.results, *res)
						if len(j.results) >= maxMatches {
							j.stop.Store(true)
						}
					}
					j.mu.Unlock()
				}
			}()
		}
		for i := range work {
			if j.stop.Load() {
				break
			}
			ch <- i
		}
		close(ch)
		wg.Wait()
		j.mu.Lock()
		j.done, j.ended = true, time.Now()
		nf := 0
		for _, n := range j.fails {
			nf += n
		}
		if nf > 0 {
			var why []string
			for w, n := range j.fails {
				why = append(why, fmt.Sprintf("%s %d개", w, n))
			}
			sort.Strings(why)
			warnf("내용 검색 [%s]: 파일 %d개를 읽지 못했습니다 (%s)", req.CQ, nf, strings.Join(why, ", "))
		}
		j.mu.Unlock()
	}()
	writeJSON(w, map[string]any{"id": j.id, "total": j.total, "indexed": len(indexed), "live": len(live),
		"skipped": skipped, "narrowed": narrowed})
}

func (s *server) contentPoll(w http.ResponseWriter, r *http.Request) {
	s.jmu.Lock()
	j := s.jobs[r.URL.Query().Get("id")]
	s.jmu.Unlock()
	if j == nil {
		bad(w, "검색 작업을 찾을 수 없습니다")
		return
	}
	from := int(num(r, "from", 0))
	j.mu.Lock()
	defer j.mu.Unlock()
	res := []cres{}
	if from < len(j.results) {
		res = j.results[from:]
	}
	end := time.Now()
	if j.done {
		end = j.ended
	}
	writeJSON(w, map[string]any{"results": res, "matched": len(j.results), "scanned": j.scanned, "total": j.total,
		"done": j.done, "stopped": j.stop.Load(), "ms": end.Sub(j.start).Milliseconds(), "limit": maxMatches,
		"fails": j.fails, "failEx": j.failEx})
}

func (s *server) contentCancel(w http.ResponseWriter, r *http.Request) {
	s.jmu.Lock()
	if j := s.jobs[r.URL.Query().Get("id")]; j != nil {
		j.stop.Store(true)
	}
	s.jmu.Unlock()
	writeJSON(w, "ok")
}
