package main

// In-memory file name index.
//
// Every file or folder is one entry: name + parent key + is-dir. Full paths
// are rebuilt on demand from parent links. Entries are sorted by lower-cased
// name once at build time, so search results come out sorted for free.
// Live changes (NTFS change journal) go into a small overlay that is folded
// back in by compact().

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

type rec struct {
	parent uint64
	name   string
	dir    bool
}

// Builder collects raw records, then builds an Index.
type Builder struct {
	recs  map[uint64]rec
	roots map[uint64]bool
}

func NewBuilder() *Builder {
	return &Builder{recs: make(map[uint64]rec, 1<<16), roots: map[uint64]bool{}}
}

func (b *Builder) AddRoot(key uint64, display string) {
	b.roots[key] = true
	b.recs[key] = rec{name: display, dir: true}
}

func (b *Builder) Add(key, parent uint64, name string, dir bool) {
	b.recs[key] = rec{parent: parent, name: name, dir: dir}
}

func (b *Builder) Len() int { return len(b.recs) }

// Build sorts entries by name. orphanRoot maps an entry whose parent is
// unknown to the root it should hang under (or false to leave it parentless).
func (b *Builder) Build(orphanRoot func(key uint64) (uint64, bool)) *Index {
	n := len(b.recs)
	type item struct {
		key uint64
		low string
	}
	items := make([]item, 0, n)
	for k, r := range b.recs {
		items = append(items, item{k, strings.ToLower(r.name)})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].low < items[j].low })
	keys := make([]uint64, n)
	for i, it := range items {
		keys[i] = it.key
	}

	ix := &Index{
		keys:    keys,
		names:   make([]string, n),
		lower:   make([]string, n),
		parent:  make([]uint64, n),
		hasPar:  make([]bool, n),
		dir:     make([]bool, n),
		keyIdx:  make(map[uint64]int32, n),
		roots:   b.roots,
		extra:   map[uint64]rec{},
		removed: map[int32]bool{},
		pcache:  map[uint64]string{},
	}
	for i, k := range keys {
		ix.keyIdx[k] = int32(i)
	}
	for i, k := range keys {
		r := b.recs[k]
		ix.names[i] = r.name
		ix.lower[i] = items[i].low
		ix.dir[i] = r.dir
		if b.roots[k] {
			continue
		}
		if _, ok := b.recs[r.parent]; ok {
			ix.parent[i], ix.hasPar[i] = r.parent, true
		} else if orphanRoot != nil {
			if p, ok := orphanRoot(k); ok {
				ix.parent[i], ix.hasPar[i] = p, true
			}
		}
	}
	return ix
}

type Index struct {
	mu      sync.RWMutex
	keys    []uint64
	names   []string
	lower   []string
	parent  []uint64
	hasPar  []bool
	dir     []bool
	keyIdx  map[uint64]int32
	roots   map[uint64]bool
	extra   map[uint64]rec // live additions / renames
	removed map[int32]bool // main entries deleted or superseded by extra
	pmu     sync.Mutex
	pcache  map[uint64]string // folder key -> full path
}

func (ix *Index) Len() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.keys) - len(ix.removed) + len(ix.extra)
}

func (ix *Index) OverlaySize() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.extra) + len(ix.removed)
}

// ---- live updates ----

func (ix *Index) Upsert(key, parent uint64, name string, dir bool) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if i, ok := ix.keyIdx[key]; ok {
		ix.removed[i] = true
	}
	ix.extra[key] = rec{parent: parent, name: name, dir: dir}
	if dir {
		ix.clearPaths()
	}
}

func (ix *Index) Remove(key uint64) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	wasDir := false
	if i, ok := ix.keyIdx[key]; ok {
		ix.removed[i] = true
		wasDir = ix.dir[i]
	}
	if r, ok := ix.extra[key]; ok {
		wasDir = wasDir || r.dir
		delete(ix.extra, key)
	}
	if wasDir {
		ix.clearPaths()
	}
}

func (ix *Index) clearPaths() {
	ix.pmu.Lock()
	ix.pcache = map[uint64]string{}
	ix.pmu.Unlock()
}

// Compact returns a fresh sorted index with the overlay merged in.
func (ix *Index) Compact() *Index {
	ix.mu.RLock()
	b := NewBuilder()
	for i, k := range ix.keys {
		if ix.removed[int32(i)] {
			continue
		}
		if ix.roots[k] {
			b.AddRoot(k, ix.names[i])
		} else {
			b.Add(k, ix.parent[i], ix.names[i], ix.dir[i])
		}
	}
	for k, r := range ix.extra {
		b.Add(k, r.parent, r.name, r.dir)
	}
	ix.mu.RUnlock()
	return b.Build(nil)
}

// ---- entry access ----

// Node returns (name, parent, hasParent, isDir, found), live overlay first.
func (ix *Index) node(key uint64) (string, uint64, bool, bool, bool) {
	if r, ok := ix.extra[key]; ok {
		return r.name, r.parent, !ix.roots[key], r.dir, true
	}
	i, ok := ix.keyIdx[key]
	if !ok {
		return "", 0, false, false, false
	}
	return ix.names[i], ix.parent[i], ix.hasPar[i], ix.dir[i], true
}

func (ix *Index) Node(key uint64) (name string, dir bool, ok bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	name, _, _, dir, ok = ix.node(key)
	return
}

func (ix *Index) Exists(key uint64) bool {
	_, _, ok := ix.Node(key)
	return ok
}

// Path rebuilds the full path by following parent links.
func (ix *Index) Path(key uint64) string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.path(key)
}

func (ix *Index) path(key uint64) string {
	name, par, has, _, ok := ix.node(key)
	if !ok {
		return ""
	}
	if !has || ix.roots[key] {
		return name
	}
	return joinPath(ix.folderPath(par), name)
}

func (ix *Index) folderPath(key uint64) string {
	ix.pmu.Lock()
	p, ok := ix.pcache[key]
	ix.pmu.Unlock()
	if ok {
		return p
	}
	// iterative walk up to avoid deep recursion
	var parts []string
	k := key
	for depth := 0; depth < 1024; depth++ {
		ix.pmu.Lock()
		cached, hit := ix.pcache[k]
		ix.pmu.Unlock()
		if hit {
			parts = append(parts, cached)
			break
		}
		name, par, has, _, ok := ix.node(k)
		if !ok {
			break
		}
		parts = append(parts, name)
		if !has || ix.roots[k] {
			break
		}
		k = par
	}
	p = parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0; i-- {
		p = joinPath(p, parts[i])
	}
	ix.pmu.Lock()
	ix.pcache[key] = p
	ix.pmu.Unlock()
	return p
}

func (ix *Index) Folder(key uint64) string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	_, par, has, _, ok := ix.node(key)
	if !ok || !has {
		return ""
	}
	return ix.folderPath(par)
}

func joinPath(dir, name string) string {
	if len(dir) == 2 && dir[1] == ':' { // "C:" -> "C:\name"
		return dir + `\` + name
	}
	if strings.HasSuffix(dir, `\`) || strings.HasSuffix(dir, "/") {
		return dir + name
	}
	if strings.Contains(dir, `\`) {
		return dir + `\` + name
	}
	return filepath.Join(dir, name)
}

// ---- search ----

// Search returns matching keys sorted by name (live changes listed first).
func (ix *Index) Search(text string) []uint64 {
	groups := ParseQuery(text)
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	if len(groups) == 1 {
		return ix.searchGroup(groups[0])
	}
	seen := map[uint64]bool{}
	var out []uint64
	for _, g := range groups {
		for _, k := range ix.searchGroup(g) {
			if !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	return out
}

func (ix *Index) searchGroup(q *Query) []uint64 {
	var out []uint64
	for k, r := range ix.extra {
		if ix.match(q, k, strings.ToLower(r.name), r.dir) {
			out = append(out, k)
		}
	}
	n := len(ix.keys)
	workers := runtime.NumCPU()
	if n < 50000 {
		workers = 1
	}
	chunk := (n + workers - 1) / workers
	parts := make([][]uint64, workers)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		lo, hi := w*chunk, (w+1)*chunk
		if hi > n {
			hi = n
		}
		if lo >= hi {
			continue
		}
		wg.Add(1)
		go func(w, lo, hi int) {
			defer wg.Done()
			var res []uint64
			for i := lo; i < hi; i++ {
				if len(ix.removed) > 0 && ix.removed[int32(i)] {
					continue
				}
				if ix.match(q, ix.keys[i], ix.lower[i], ix.dir[i]) {
					res = append(res, ix.keys[i])
				}
			}
			parts[w] = res
		}(w, lo, hi)
	}
	wg.Wait()
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func (ix *Index) match(q *Query, key uint64, low string, dir bool) bool {
	for _, t := range q.Plain {
		if !strings.Contains(low, t) {
			return false
		}
	}
	for _, t := range q.Negated {
		if strings.Contains(low, t) {
			return false
		}
	}
	for _, w := range q.Wildcards {
		if !wildMatch(w, low) {
			return false
		}
	}
	if q.Only == "file" && dir || q.Only == "folder" && !dir {
		return false
	}
	if q.Exts != nil {
		if dir {
			return false
		}
		dot := strings.LastIndexByte(low, '.')
		if dot < 0 || !q.Exts[low[dot+1:]] {
			return false
		}
	}
	if len(q.Paths) > 0 {
		p := strings.ReplaceAll(strings.ToLower(ix.path(key)), "/", `\`)
		for _, t := range q.Paths {
			if !strings.Contains(p, t) {
				return false
			}
		}
	}
	return true
}
