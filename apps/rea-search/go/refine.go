package main

// Narrowing a result list from inside it (the filter bar and the column
// filters): file type, extension, folder, text within the results, date and
// size, each with counts of what it would leave, plus grouping.

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

func keyStr(k uint64) string { return strconv.FormatUint(k, 10) }

func parseKey(s string) (uint64, bool) {
	k, err := strconv.ParseUint(s, 10, 64)
	return k, err == nil
}

// Slice is the narrowing chosen in the filter bar. Every part is ANDed.
type Slice struct {
	Cats    []string // categories (doc, image, folder...), none = all
	Exts    []string // lower case, "" = no extension, "/" = folders
	Under   uint64   // folder key, 0 = everywhere
	Within  string   // words the name (or path, with \ or /) must contain; !word excludes
	After   int64    // modified at or after (unix), 0 = no limit
	Before  int64    // modified before (unix), 0 = no limit
	MinSize int64    // bytes, -1 = no limit
	MaxSize int64
}

func noSlice() Slice { return Slice{MinSize: -1, MaxSize: -1} }

func (s Slice) timeOn() bool { return s.After > 0 || s.Before > 0 }
func (s Slice) sizeOn() bool { return s.MinSize >= 0 || s.MaxSize >= 0 }
func (s Slice) active() bool {
	return len(s.Cats) > 0 || len(s.Exts) > 0 || s.Under != 0 || strings.TrimSpace(s.Within) != "" || s.timeOn() || s.sizeOn()
}

// Parent returns the folder holding k; ok is false at a drive or share root.
func (v *View) Parent(k uint64) (uint64, bool) {
	_, _, par, has, _ := v.nodeParent(k)
	return par, has
}

// nodeParent is Node and Parent in one lookup.
func (v *View) nodeParent(k uint64) (name string, dir bool, par uint64, hasPar, ok bool) {
	ix := v.of(k)
	ix.mu.RLock()
	name, par, hasPar, dir, ok = ix.node(k)
	if !ok || ix.roots[k] {
		par, hasPar = 0, false
	}
	ix.mu.RUnlock()
	return
}

// FolderCount is one subfolder in the folder facet.
type FolderCount struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Crumb is one step of the path to the folder being looked at.
type Crumb struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// FolderFacet says where a result list lives below a folder.
type FolderFacet struct {
	Crumbs  []Crumb       `json:"crumbs"`  // root ... current folder (empty = everywhere)
	Folders []FolderCount `json:"folders"` // biggest first
	Here    int           `json:"here"`    // results directly in the current folder
	More    int           `json:"more"`    // subfolders not listed
}

type ExtCount struct {
	Ext   string `json:"ext"`
	Count int    `json:"count"`
}

// refiner answers "which child of under holds k" with memory per folder, so
// a million results cost about one lookup each.
type refiner struct {
	v     *View
	under uint64
	memo  map[uint64]uint64 // folder -> child of under on its path, or noChild

	lastPar, lastRes uint64
	hasLast          bool
}

const noChild = ^uint64(0)

func newRefiner(v *View, under uint64) *refiner {
	return &refiner{v: v, under: under, memo: map[uint64]uint64{}}
}

// bucket returns the child of under that holds k (k itself when it is a
// direct child), under when k is directly inside it, or noChild when k is
// not below under at all. With under 0 the buckets are drive or share roots.
func (r *refiner) bucket(k uint64) uint64 {
	_, _, par, ok, _ := r.v.nodeParent(k)
	return r.bucketOf(k, par, ok)
}

func (r *refiner) bucketOf(k, par uint64, ok bool) uint64 {
	if k == r.under && r.under != 0 {
		return noChild // the folder itself is not "inside" it
	}
	if !ok {
		if r.under == 0 {
			return k // a root
		}
		return noChild
	}
	if par == r.under {
		return k
	}
	if par == r.lastPar && r.hasLast {
		return r.lastRes // results come grouped by folder more often than not
	}
	res := r.folder(par)
	r.lastPar, r.lastRes, r.hasLast = par, res, true
	return res
}

// folder is bucket for a folder key, memoised.
func (r *refiner) folder(f uint64) uint64 {
	var chain []uint64
	res := noChild
	for depth := 0; depth < 1024; depth++ {
		if b, ok := r.memo[f]; ok {
			res = b
			break
		}
		chain = append(chain, f)
		par, ok := r.v.Parent(f)
		if !ok {
			if r.under == 0 {
				res = f
			}
			break
		}
		if par == r.under {
			res = f
			break
		}
		f = par
	}
	for _, c := range chain {
		r.memo[c] = res
	}
	return res
}

func (r *refiner) inside(k uint64) bool {
	return r.under == 0 || r.bucket(k) != noChild
}

func extKey(name string, dir bool) string {
	if dir {
		return "/" // folders
	}
	dot := strings.LastIndexByte(name, '.')
	if dot <= 0 || dot == len(name)-1 {
		return ""
	}
	e := name[dot+1:]
	for i := 0; i < len(e); i++ {
		if c := e[i]; c >= 'A' && c <= 'Z' || c >= 0x80 {
			return strings.ToLower(e)
		}
	}
	return e // already lower case: no copy
}

// RangeCount is one date or size choice with how many results it would leave.
type RangeCount struct {
	ID    string `json:"id"`
	From  int64  `json:"from"` // after / min size (-1 none)
	To    int64  `json:"to"`   // before / max size (-1 none)
	Count int    `json:"count"`
}

// SliceFacets is what the filter bar shows: for each part, the counts it
// would give with the other parts kept (so choices can be changed while
// seeing what each would leave), and totals for the narrowed list.
type SliceFacets struct {
	Total     int            `json:"total"`
	Bytes     int64          `json:"bytes"`
	MetaKnown bool           `json:"metaKnown"` // sizes and dates read for all results
	Cats      map[string]int `json:"cats"`
	Exts      []ExtCount     `json:"exts"`
	Folder    FolderFacet    `json:"folder"`
	// Parents are the folders that directly hold results (full paths),
	// most results first: the side panel's "결과가 있는 폴더".
	Parents     []FolderCount `json:"parents"`
	ParentsMore int           `json:"parentsMore"`
	Under     string         `json:"under"` // folder the panel shows (may be deeper than asked)
	Dates     []RangeCount   `json:"dates"`
	Sizes     []RangeCount   `json:"sizes"`
}

const (
	dimCat = 1 << iota
	dimExt
	dimUnder
	dimWithin
	dimTime
	dimSize
	dimAll = dimCat | dimExt | dimUnder | dimWithin | dimTime | dimSize
)

// FacetMetaLimit is how many results get their size and date read just to
// count the date and size choices (a filter on them reads them anyway).
const FacetMetaLimit = 60000

func datePresets(now time.Time) []RangeCount {
	mid := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	day := func(n int) int64 { return mid.AddDate(0, 0, n).Unix() }
	jan1 := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	return []RangeCount{
		{ID: "today", From: day(0), To: 0},
		{ID: "yesterday", From: day(-1), To: day(0)},
		{ID: "7d", From: day(-6), To: 0},
		{ID: "30d", From: day(-29), To: 0},
		{ID: "year", From: jan1.Unix(), To: 0},
		{ID: "lastyear", From: jan1.AddDate(-1, 0, 0).Unix(), To: jan1.Unix()},
		{ID: "old", From: 0, To: now.AddDate(-1, 0, 0).Unix()},
	}
}

func sizePresets() []RangeCount {
	const kb, mb, gb = 1 << 10, 1 << 20, 1 << 30
	return []RangeCount{
		{ID: "zero", From: 0, To: 0},
		{ID: "tiny", From: 1, To: 100*kb - 1},
		{ID: "small", From: 100 * kb, To: mb - 1},
		{ID: "medium", From: mb, To: 10*mb - 1},
		{ID: "large", From: 10 * mb, To: 100*mb - 1},
		{ID: "huge", From: 100 * mb, To: gb - 1},
		{ID: "giant", From: gb, To: -1},
	}
}

func inTime(m meta, after, before int64) bool {
	return (after <= 0 || m.mod >= after) && (before <= 0 || m.mod < before)
}

func inSize(m meta, min, max int64) bool {
	return m.size >= 0 && (min < 0 || m.size >= min) && (max < 0 || m.size <= max)
}

type withinTerm struct {
	text string
	not  bool
	path bool
}

func parseWithin(s string) []withinTerm {
	var out []withinTerm
	for _, f := range strings.Fields(strings.ToLower(s)) {
		t := withinTerm{text: f}
		if strings.HasPrefix(f, "!") || strings.HasPrefix(f, "-") && len(f) > 1 {
			t.not, t.text = true, f[1:]
		}
		t.path = strings.ContainsAny(t.text, `\/`)
		if t.text != "" {
			out = append(out, t)
		}
	}
	return out
}

// ApplySlice narrows keys (keeping their order). With facets it also counts
// every choice; that reads sizes and dates for up to FacetMetaLimit results.
func ApplySlice(v *View, keys []uint64, sl Slice, facets bool) ([]uint64, *SliceFacets) {
	cats := map[string]bool{}
	for _, c := range sl.Cats {
		cats[c] = true
	}
	exts := map[string]bool{}
	for _, e := range sl.Exts {
		exts[e] = true
	}
	terms := parseWithin(sl.Within)
	metaKnown := false
	if sl.timeOn() || sl.sizeOn() {
		v.EnsureMeta(keys[:min(len(keys), MetaLimit)], nil)
		metaKnown = len(keys) <= MetaLimit
	} else if facets && len(keys) <= FacetMetaLimit {
		v.EnsureMeta(keys, nil)
		metaKnown = true
	}
	var dates, sizes []RangeCount
	var fac *SliceFacets
	if facets {
		dates, sizes = datePresets(time.Now()), sizePresets()
		fac = &SliceFacets{Cats: map[string]int{}, MetaKnown: metaKnown}
	}
	r := newRefiner(v, sl.Under)
	byFolder := map[uint64]int{}
	byParent := map[uint64]int{}
	byExt := map[string]int{}
	here := 0
	out := make([]uint64, 0, min(len(keys), 1<<16))
	for _, k := range keys {
		name, dir, par, hasPar, ok := v.nodeParent(k)
		if !ok {
			continue
		}
		pass := dimAll
		var cat, e string
		if len(cats) > 0 || fac != nil {
			if cat = categoryOf(name, dir); len(cats) > 0 && !cats[cat] {
				pass &^= dimCat
			}
		}
		if len(exts) > 0 || fac != nil {
			if e = extKey(name, dir); len(exts) > 0 && !exts[e] {
				pass &^= dimExt
			}
		}
		b := noChild
		if sl.Under != 0 || fac != nil {
			if b = r.bucketOf(k, par, hasPar); sl.Under != 0 && b == noChild {
				pass &^= dimUnder
			}
		}
		if fac == nil && pass != dimAll {
			continue
		}
		if len(terms) > 0 {
			lower := strings.ToLower(name)
			var path string
			for _, t := range terms {
				hay := lower
				if t.path {
					if path == "" {
						path = strings.ToLower(v.Path(k))
					}
					hay = path
				}
				if strings.Contains(hay, t.text) == t.not {
					pass &^= dimWithin
					break
				}
			}
		}
		var m meta
		if sl.timeOn() || sl.sizeOn() || metaKnown {
			m, _ = v.Meta(k)
		}
		if sl.timeOn() && (!m.ok || !inTime(m, sl.After, sl.Before)) {
			pass &^= dimTime
		}
		if sl.sizeOn() && (!m.ok || dir || !inSize(m, sl.MinSize, sl.MaxSize)) {
			pass &^= dimSize
		}
		if pass == dimAll {
			out = append(out, k)
		}
		if fac == nil {
			continue
		}
		others := func(d int) bool { return pass|d == dimAll }
		if others(dimCat) {
			fac.Cats[cat]++
		}
		if others(dimExt) {
			byExt[e]++
		}
		if pass == dimAll {
			if hasPar {
				byParent[par]++
			}
			if b == k && sl.Under != 0 {
				here++ // directly in the folder (a matching subfolder counts here)
			} else {
				byFolder[b]++
			}
			if m.ok && !dir && m.size > 0 {
				fac.Bytes += m.size
			}
		}
		if metaKnown && m.ok {
			if others(dimTime) {
				for i := range dates {
					if inTime(m, dates[i].From, dates[i].To) {
						dates[i].Count++
					}
				}
			}
			if others(dimSize) && !dir {
				for i := range sizes {
					if inSize(m, sizes[i].From, sizes[i].To) {
						sizes[i].Count++
					}
				}
			}
		}
	}
	if fac == nil {
		return out, nil
	}
	fac.Total = len(out)
	fac.Dates, fac.Sizes = dates, sizes
	fac.Folder = folderFacet(v, sl.Under, byFolder, here)
	fac.Parents, fac.ParentsMore = parentFacet(v, byParent)
	for e, n := range byExt {
		fac.Exts = append(fac.Exts, ExtCount{Ext: e, Count: n})
	}
	sort.Slice(fac.Exts, func(i, j int) bool {
		a, b := fac.Exts[i], fac.Exts[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return a.Ext < b.Ext
	})
	fac.Under = keyStr(sl.Under)
	return out, fac
}

// parentFacet lists the folders holding results, biggest first, with paths
// looked up only for the ones shown.
func parentFacet(v *View, byParent map[uint64]int) ([]FolderCount, int) {
	type pc struct {
		k uint64
		n int
	}
	list := make([]pc, 0, len(byParent))
	for k, n := range byParent {
		list = append(list, pc{k, n})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].n != list[j].n {
			return list[i].n > list[j].n
		}
		return list[i].k < list[j].k
	})
	const show = 100
	more := 0
	if len(list) > show {
		more, list = len(list)-show, list[:show]
	}
	out := make([]FolderCount, 0, len(list))
	for _, p := range list {
		out = append(out, FolderCount{Key: keyStr(p.k), Name: v.Path(p.k), Count: p.n})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, more
}

func folderFacet(v *View, under uint64, byFolder map[uint64]int, here int) FolderFacet {
	ff := FolderFacet{Here: here}
	for f := under; f != 0; {
		name, _, ok := v.Node(f)
		if !ok {
			break
		}
		ff.Crumbs = append(ff.Crumbs, Crumb{Key: keyStr(f), Name: name})
		p, ok := v.Parent(f)
		if !ok {
			break
		}
		f = p
	}
	for i, j := 0, len(ff.Crumbs)-1; i < j; i, j = i+1, j-1 {
		ff.Crumbs[i], ff.Crumbs[j] = ff.Crumbs[j], ff.Crumbs[i]
	}
	for f, n := range byFolder {
		name, _, _ := v.Node(f)
		if under == 0 {
			name = v.Path(f) // roots: "C:", "\\server\share"
		}
		ff.Folders = append(ff.Folders, FolderCount{Key: keyStr(f), Name: name, Count: n})
	}
	sort.Slice(ff.Folders, func(i, j int) bool {
		a, b := ff.Folders[i], ff.Folders[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	const showFolders = 80
	if len(ff.Folders) > showFolders {
		ff.More = len(ff.Folders) - showFolders
		ff.Folders = ff.Folders[:showFolders]
	}
	return ff
}

// SliceAuto is ApplySlice with facets, but when every result sits in one
// subfolder (and none directly in the chosen one) the folder panel goes
// deeper until there is a choice to show, so it opens at e.g. D:\업무\2024
// with its subfolders instead of a single "D:" line. The result list is the
// same either way, since everything was inside that subfolder.
func SliceAuto(v *View, keys []uint64, sl Slice) ([]uint64, *SliceFacets) {
	out, fac := ApplySlice(v, keys, sl, true)
	for i := 0; i < 64 && len(fac.Folder.Folders) == 1 && fac.Folder.Here == 0 && fac.Folder.More == 0; i++ {
		k, _ := parseKey(fac.Folder.Folders[0].Key)
		if _, dir, _ := v.Node(k); !dir {
			break
		}
		next := sl
		next.Under = k
		o2, f2 := ApplySlice(v, keys, next, true)
		if len(o2) != len(out) || len(f2.Folder.Folders) == 0 && f2.Folder.Here == 0 {
			break
		}
		out, fac, sl = o2, f2, next
	}
	return out, fac
}

// ---- grouping ----

// GroupInfo is one group of a grouped result list, in display order.
type GroupInfo struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// groupKey is the group of one result for "folder", "cat", "ext", "date"
// or "size"; date and size use the preset ids (disjoint buckets).
func groupKey(v *View, k uint64, by string, dates []RangeCount) string {
	name, dir, _ := v.Node(k)
	switch by {
	case "folder":
		return v.Folder(k)
	case "cat":
		return categoryOf(name, dir)
	case "ext":
		return extKey(name, dir)
	case "date":
		m, ok := v.Meta(k)
		if !ok || !m.ok {
			return "unknown"
		}
		// today, yesterday, rest of 7 days, rest of 30 days, rest of this year, last year, older
		for _, id := range []string{"today", "yesterday", "7d", "30d", "year", "lastyear"} {
			for _, d := range dates {
				if d.ID == id && inTime(m, d.From, d.To) {
					return id
				}
			}
		}
		return "older"
	case "size":
		if dir {
			return "folder"
		}
		m, ok := v.Meta(k)
		if !ok || !m.ok {
			return "unknown"
		}
		for _, s := range sizePresets() {
			if inSize(m, s.From, s.To) {
				return s.ID
			}
		}
	}
	return ""
}

var groupOrder = map[string][]string{
	"cat":  categoryOrder,
	"date": {"today", "yesterday", "7d", "30d", "year", "lastyear", "older", "unknown"},
	"size": {"giant", "huge", "large", "medium", "small", "tiny", "zero", "folder", "unknown"},
}

// GroupBy reorders keys so each group is together (keeping the order inside
// a group) and returns the groups in display order with each key's group.
func GroupBy(v *View, keys []uint64, by string) ([]uint64, []GroupInfo, map[uint64]string) {
	if by == "date" || by == "size" {
		v.EnsureMeta(keys[:min(len(keys), MetaLimit)], nil)
	}
	dates := datePresets(time.Now())
	gk := make(map[uint64]string, len(keys))
	count := map[string]int{}
	for _, k := range keys {
		g := groupKey(v, k, by, dates)
		gk[k] = g
		count[g]++
	}
	var order []string
	if o, ok := groupOrder[by]; ok {
		for _, g := range o {
			if count[g] > 0 {
				order = append(order, g)
			}
		}
	} else {
		for g := range count {
			order = append(order, g)
		}
		sort.Slice(order, func(i, j int) bool { return strings.ToLower(order[i]) < strings.ToLower(order[j]) })
	}
	rank := map[string]int{}
	groups := make([]GroupInfo, len(order))
	for i, g := range order {
		rank[g] = i
		groups[i] = GroupInfo{Key: g, Count: count[g]}
	}
	out := append([]uint64(nil), keys...)
	sort.SliceStable(out, func(i, j int) bool { return rank[gk[out[i]]] < rank[gk[out[j]]] })
	return out, groups, gk
}
