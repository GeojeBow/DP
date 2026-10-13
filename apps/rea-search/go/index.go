package main

// In-memory file name index, laid out for millions of entries.
//
// Every file or folder is one entry: name + parent + is-dir. Full paths are
// rebuilt on demand from parent links. Entries are sorted by lower-cased name
// once at build time, so search results come out sorted for free.
//
// Memory: names are not kept as millions of separate strings. All names are
// packed into one byte arena (plus one for the lower-cased copy used by the
// search loop) with 4-byte offsets, parents are 4-byte positions, and key
// lookups use a sorted position table instead of a hash map. That is about
// 25 bytes per entry plus twice the name length: roughly 75 bytes for a
// typical name, so 5 million files fit in well under 0.5 GB.
//
// Live changes (NTFS change journal) go into a small overlay that is folded
// back in by Compact().

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"unsafe"
)

type rec struct {
	parent uint64
	name   string
	dir    bool
}

// Builder collects raw records, then builds an Index.
type Builder struct {
	keys, pkeys []uint64
	names       []string
	dirs        []bool
	sizes, mods []int64 // size/date known at scan time; mod -1 = unknown
	roots       map[uint64]bool
}

func NewBuilder() *Builder {
	return &Builder{roots: map[uint64]bool{}}
}

func (b *Builder) AddRoot(key uint64, display string) {
	b.roots[key] = true
	b.Add(key, 0, display, true)
}

func (b *Builder) Add(key, parent uint64, name string, dir bool) {
	b.keys = append(b.keys, key)
	b.pkeys = append(b.pkeys, parent)
	b.names = append(b.names, name)
	b.dirs = append(b.dirs, dir)
	b.sizes = append(b.sizes, 0)
	b.mods = append(b.mods, -1)
}

// AddMeta records size and modification time of the record just added, when
// the scanner already has them (folder walking gets them for free on Windows).
func (b *Builder) AddMeta(key uint64, size, mod int64) {
	if n := len(b.keys); n > 0 && b.keys[n-1] == key {
		b.sizes[n-1], b.mods[n-1] = size, mod
	}
}

func (b *Builder) Len() int { return len(b.keys) }

// Build sorts entries by name. orphanRoot maps an entry whose parent is
// unknown to the root it should hang under (or false to leave it parentless).
func (b *Builder) Build(orphanRoot func(key uint64) (uint64, bool)) *Index {
	n := len(b.keys)
	lows := make([]string, n)
	for i, nm := range b.names {
		lows[i] = strings.ToLower(nm)
	}
	order := make([]int32, n) // order[pos] = builder record
	for i := range order {
		order[i] = int32(i)
	}
	sort.Slice(order, func(a, c int) bool { return lows[order[a]] < lows[order[c]] })

	ix := newIndex()
	ix.keys = make([]uint64, n)
	ix.off = make([]uint32, n+1)
	ix.loff = make([]uint32, n+1)
	ix.parent = make([]int32, n)
	ix.dir = make([]bool, n)
	ix.size = make([]int64, n)
	ix.mod = make([]int64, n)
	total, ltotal := 0, 0
	for i := range b.names {
		total += len(b.names[i])
		ltotal += len(lows[i])
	}
	ix.arena = make([]byte, 0, total)
	ix.larena = make([]byte, 0, ltotal)
	for pos, r := range order {
		ix.keys[pos] = b.keys[r]
		ix.off[pos] = uint32(len(ix.arena))
		ix.loff[pos] = uint32(len(ix.larena))
		ix.arena = append(ix.arena, b.names[r]...)
		ix.larena = append(ix.larena, lows[r]...)
		ix.dir[pos] = b.dirs[r]
		ix.size[pos], ix.mod[pos] = b.sizes[r], b.mods[r]
	}
	ix.off[n], ix.loff[n] = uint32(len(ix.arena)), uint32(len(ix.larena))
	ix.buildByKey()
	for pos, r := range order {
		k := b.keys[r]
		ix.parent[pos] = -1
		if b.roots[k] {
			continue
		}
		p := ix.pos(b.pkeys[r])
		if p < 0 && orphanRoot != nil {
			if rk, ok := orphanRoot(k); ok {
				p = ix.pos(rk)
			}
		}
		ix.parent[pos] = int32(p)
	}
	for k := range b.roots {
		ix.roots[k] = true
	}
	return ix
}

type Index struct {
	mu     sync.RWMutex
	keys   []uint64 // by position (name order)
	arena  []byte   // names, packed
	off    []uint32 // name of position i = arena[off[i]:off[i+1]]
	larena []byte   // lower-cased names, packed
	loff   []uint32
	parent []int32 // parent position, -1 = none
	dir    []bool
	bykey  []int32 // positions sorted by key, for lookups
	roots  map[uint64]bool

	metaMu sync.RWMutex
	size   []int64 // -1 for folders once known
	mod    []int64 // unix seconds; -1 = not read yet

	extra     map[uint64]rec  // live additions / renames
	extraMeta map[uint64]meta // their sizes/dates
	removed   map[int32]bool  // main entries deleted or superseded by extra

	pmu    sync.Mutex
	pcache map[uint64]string // folder key -> full path
}

func newIndex() *Index {
	return &Index{off: []uint32{0}, loff: []uint32{0}, roots: map[uint64]bool{}, extra: map[uint64]rec{},
		extraMeta: map[uint64]meta{}, removed: map[int32]bool{}, pcache: map[uint64]string{}}
}

func (ix *Index) buildByKey() {
	ix.bykey = make([]int32, len(ix.keys))
	for i := range ix.bykey {
		ix.bykey[i] = int32(i)
	}
	sort.Slice(ix.bykey, func(a, b int) bool { return ix.keys[ix.bykey[a]] < ix.keys[ix.bykey[b]] })
}

// pos finds the position of a key in the main arrays, or -1.
func (ix *Index) pos(key uint64) int {
	bk := ix.bykey
	i := sort.Search(len(bk), func(i int) bool { return ix.keys[bk[i]] >= key })
	if i < len(bk) && ix.keys[bk[i]] == key {
		return int(bk[i])
	}
	return -1
}

func bstr(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return unsafe.String(&b[0], len(b))
}

func (ix *Index) name(i int) string  { return bstr(ix.arena[ix.off[i]:ix.off[i+1]]) }
func (ix *Index) lower(i int) string { return bstr(ix.larena[ix.loff[i]:ix.loff[i+1]]) }

// IndexState is the on-disk form of an Index (see cache.go).
type IndexState struct {
	Keys          []uint64
	Arena, LArena []byte
	Off, LOff     []uint32
	Parent        []int32
	Dir           []bool
	Size, Mod     []int64
	Roots         []uint64
}

func (ix *Index) State() *IndexState {
	if ix.OverlaySize() > 0 {
		ix = ix.Compact()
	}
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	ix.metaMu.RLock()
	defer ix.metaMu.RUnlock()
	st := &IndexState{Keys: ix.keys, Arena: ix.arena, LArena: ix.larena, Off: ix.off, LOff: ix.loff,
		Parent: ix.parent, Dir: ix.dir, Size: append([]int64{}, ix.size...), Mod: append([]int64{}, ix.mod...)}
	for k := range ix.roots {
		st.Roots = append(st.Roots, k)
	}
	return st
}

func IndexFromState(st *IndexState) *Index {
	ix := newIndex()
	ix.keys, ix.arena, ix.larena, ix.off, ix.loff = st.Keys, st.Arena, st.LArena, st.Off, st.LOff
	ix.parent, ix.dir, ix.size, ix.mod = st.Parent, st.Dir, st.Size, st.Mod
	if len(ix.off) == 0 {
		ix.off, ix.loff = []uint32{0}, []uint32{0}
	}
	for _, k := range st.Roots {
		ix.roots[k] = true
	}
	ix.buildByKey()
	return ix
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
	if i := ix.pos(key); i >= 0 {
		ix.removed[int32(i)] = true
	}
	ix.extra[key] = rec{parent: parent, name: name, dir: dir}
	ix.metaMu.Lock()
	delete(ix.extraMeta, key) // re-read on demand
	ix.metaMu.Unlock()
	if dir {
		ix.clearPaths()
	}
}

func (ix *Index) Remove(key uint64) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	wasDir := false
	if i := ix.pos(key); i >= 0 {
		ix.removed[int32(i)] = true
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
	ix.metaMu.RLock()
	for i, k := range ix.keys {
		if ix.removed[int32(i)] {
			continue
		}
		if ix.roots[k] {
			b.AddRoot(k, ix.name(i))
		} else {
			var pk uint64
			if p := ix.parent[i]; p >= 0 {
				pk = ix.keys[p]
			}
			b.Add(k, pk, strings.Clone(ix.name(i)), ix.dir[i])
		}
		if ix.mod[i] >= 0 {
			b.AddMeta(k, ix.size[i], ix.mod[i])
		}
	}
	for k, r := range ix.extra {
		b.Add(k, r.parent, r.name, r.dir)
		if m, ok := ix.extraMeta[k]; ok && m.ok {
			b.AddMeta(k, m.size, m.mod)
		}
	}
	ix.metaMu.RUnlock()
	ix.mu.RUnlock()
	return b.Build(nil)
}

// ---- entry access ----

// node returns (name, parent key, hasParent, isDir, found), live overlay first.
func (ix *Index) node(key uint64) (string, uint64, bool, bool, bool) {
	if r, ok := ix.extra[key]; ok {
		return r.name, r.parent, !ix.roots[key], r.dir, true
	}
	i := ix.pos(key)
	if i < 0 || ix.removed[int32(i)] {
		return "", 0, false, false, false
	}
	p := ix.parent[i]
	if p < 0 {
		return ix.name(i), 0, false, ix.dir[i], true
	}
	return ix.name(i), ix.keys[p], true, ix.dir[i], true
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

// Meta returns the cached size/date of a key.
func (ix *Index) Meta(key uint64) (meta, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	ix.metaMu.RLock()
	defer ix.metaMu.RUnlock()
	if _, ok := ix.extra[key]; ok {
		m, ok := ix.extraMeta[key]
		return m, ok
	}
	i := ix.pos(key)
	if i < 0 || ix.mod[i] < 0 {
		return meta{}, false
	}
	return meta{size: ix.size[i], mod: ix.mod[i], ok: ix.mod[i] > 0 || ix.size[i] != 0}, true
}

func (ix *Index) setMeta(batch map[uint64]meta) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	ix.metaMu.Lock()
	defer ix.metaMu.Unlock()
	for k, m := range batch {
		if _, ok := ix.extra[k]; ok {
			ix.extraMeta[k] = m
			continue
		}
		if i := ix.pos(k); i >= 0 {
			if m.ok {
				ix.size[i], ix.mod[i] = m.size, m.mod
			} else {
				ix.size[i], ix.mod[i] = 0, 0 // could not be read
			}
		}
	}
}

// Forget drops cached size/date so they are read again.
func (ix *Index) Forget(key uint64) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	ix.metaMu.Lock()
	defer ix.metaMu.Unlock()
	delete(ix.extraMeta, key)
	if i := ix.pos(key); i >= 0 {
		ix.mod[i] = -1
	}
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
	if len(parts) == 0 {
		return ""
	}
	p = parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0; i-- {
		p = joinPath(p, parts[i])
	}
	ix.pmu.Lock()
	if len(ix.pcache) > 300000 { // bound memory on huge trees
		ix.pcache = map[uint64]string{}
	}
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

// NameOpts are the search-box toggles.
type NameOpts struct {
	Case  bool // match case
	Path  bool // match plain terms against the full path, not just the name
	Regex bool // the whole query is one regular expression
}

// Search returns matching keys sorted by name (live changes listed first).
func (ix *Index) Search(text string) []uint64 { return ix.SearchOpts(text, NameOpts{}) }

func (ix *Index) SearchOpts(text string, o NameOpts) []uint64 {
	groups, err := ParseQueryOpts(text, o)
	if err != nil {
		return nil
	}
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
		if ix.match(q, k, r.name, strings.ToLower(r.name), r.dir) {
			out = append(out, k)
		}
	}
	n := len(ix.keys)
	if q.Empty() && len(ix.removed) == 0 {
		return append(out, ix.keys...)
	}
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
				if ix.match(q, ix.keys[i], ix.name(i), ix.lower(i), ix.dir[i]) {
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

func (ix *Index) match(q *Query, key uint64, name, low string, dir bool) bool {
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
	subject := low
	if q.Case {
		subject = name
	}
	if q.InPath {
		subject = ix.path(key)
		if !q.Case {
			subject = strings.ToLower(subject)
		}
	}
	if q.Re != nil {
		return q.Re.MatchString(subject)
	}
	for _, t := range q.Plain {
		if !strings.Contains(subject, t) {
			return false
		}
	}
	for _, t := range q.Negated {
		if strings.Contains(subject, t) {
			return false
		}
	}
	for _, w := range q.Wildcards {
		ws := low
		if q.Case {
			ws = name
		}
		if !wildMatch(w, ws) {
			return false
		}
	}
	if len(q.Paths) > 0 {
		p := strings.ReplaceAll(ix.path(key), "/", `\`)
		if !q.Case {
			p = strings.ToLower(p)
		}
		for _, t := range q.Paths {
			if !strings.Contains(p, t) {
				return false
			}
		}
	}
	return true
}
