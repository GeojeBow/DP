package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var webFS embed.FS

type row struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Folder string `json:"folder"`
	Dir    bool   `json:"dir"`
	Size   int64  `json:"size"`
	Mod    string `json:"mod"`
}

type server struct {
	eng   *Engine
	token string
	host  string

	mu      sync.Mutex
	lastQ   string
	lastV   int
	lastIx  *Index
	lastRes []uint64
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
		h(w, r)
	}
}

func (s *server) routes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("/", s.page)
	m.HandleFunc("/api/search", s.guard(s.search))
	m.HandleFunc("/api/status", s.guard(s.status))
	m.HandleFunc("/api/open", s.guard(s.open))
	return m
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

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	mode, status, version, total := s.eng.Info()
	writeJSON(w, map[string]any{"mode": mode, "status": status, "version": version, "total": total})
}

// search returns one page of results. The full result list of the last query
// is kept so scrolling further does not search again.
func (s *server) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	_, _, version, _ := s.eng.Info()
	ix := s.eng.Index()

	start := time.Now()
	s.mu.Lock()
	if q != s.lastQ || version != s.lastV || ix != s.lastIx || s.lastRes == nil {
		s.lastRes = ix.Search(q)
		s.lastQ, s.lastV, s.lastIx = q, version, ix
	}
	res := s.lastRes
	s.mu.Unlock()
	ms := float64(time.Since(start).Microseconds()) / 1000

	rows := []row{}
	for i := offset; i < len(res) && i < offset+limit; i++ {
		k := res[i]
		name, dir, ok := ix.Node(k)
		if !ok {
			continue
		}
		folder := ix.Folder(k)
		rw := row{Key: strconv.FormatUint(k, 10), Name: name, Folder: folder, Dir: dir, Size: -1}
		if st, err := os.Lstat(joinPath(folder, name)); err == nil {
			rw.Mod = st.ModTime().Format("2006-01-02 15:04")
			if !dir {
				rw.Size = st.Size()
			}
		}
		rows = append(rows, rw)
	}
	writeJSON(w, map[string]any{"total": len(res), "ms": ms, "rows": rows, "version": version})
}

// open acts on an indexed item by key (never on a path sent by the client).
func (s *server) open(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	k, err := strconv.ParseUint(r.URL.Query().Get("key"), 10, 64)
	if err != nil {
		http.Error(w, "bad key", http.StatusBadRequest)
		return
	}
	ix := s.eng.Index()
	p := ix.Path(k)
	if p == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	switch r.URL.Query().Get("how") {
	case "reveal":
		err = revealPath(p)
	case "path":
		writeJSON(w, map[string]string{"path": p})
		return
	default:
		err = openPath(p)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": p})
}
