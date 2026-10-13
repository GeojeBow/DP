package main

// Narrowing a result list from inside it: "only what is under this folder"
// and "only these extensions", with counts per subfolder and per extension
// so the user can see where the results are and click into them.

import (
	"sort"
	"strconv"
	"strings"
)

func keyStr(k uint64) string { return strconv.FormatUint(k, 10) }

func parseKey(s string) (uint64, bool) {
	k, err := strconv.ParseUint(s, 10, 64)
	return k, err == nil
}

// Refine is the in-results narrowing chosen in the facet panel.
type Refine struct {
	Under uint64   // folder key, 0 = everywhere
	Exts  []string // lower case, "" = files without an extension
}

func (r Refine) active() bool { return r.Under != 0 || len(r.Exts) > 0 }

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

// ApplyRefine narrows keys (keeping their order) and returns the facets:
// folders are counted over results matching the extension choice, and
// extensions over results under the chosen folder, so either can be changed
// while seeing what the other would leave.
func ApplyRefine(v *View, keys []uint64, rf Refine) ([]uint64, FolderFacet, []ExtCount) {
	exts := map[string]bool{}
	for _, e := range rf.Exts {
		exts[e] = true
	}
	r := newRefiner(v, rf.Under)
	out := make([]uint64, 0, len(keys))
	byFolder := map[uint64]int{}
	byExt := map[string]int{}
	here := 0
	for _, k := range keys {
		name, dir, par, hasPar, ok := v.nodeParent(k)
		if !ok {
			continue
		}
		b := r.bucketOf(k, par, hasPar)
		if rf.Under != 0 && b == noChild {
			continue
		}
		e := extKey(name, dir)
		byExt[e]++
		if len(exts) > 0 && !exts[e] {
			continue
		}
		if b == k && rf.Under != 0 {
			here++ // directly in the folder (a matching subfolder counts here, not as its own bucket)
		} else {
			byFolder[b]++
		}
		out = append(out, k)
	}
	ff := FolderFacet{Here: here}
	for f := rf.Under; f != 0; {
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
		if rf.Under == 0 {
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
	const showFolders = 60
	if len(ff.Folders) > showFolders {
		ff.More = len(ff.Folders) - showFolders
		ff.Folders = ff.Folders[:showFolders]
	}
	var ec []ExtCount
	for e, n := range byExt {
		ec = append(ec, ExtCount{Ext: e, Count: n})
	}
	sort.Slice(ec, func(i, j int) bool {
		if ec[i].Count != ec[j].Count {
			return ec[i].Count > ec[j].Count
		}
		return ec[i].Ext < ec[j].Ext
	})
	return out, ff, ec
}

// RefineAuto is ApplyRefine, but when every result sits in one subfolder
// (and none directly in the chosen one) it goes deeper until there is a
// choice to show, so the panel opens at e.g. D:\업무\2024 with its
// subfolders instead of a single "D:" line. The result list is the same
// either way, since everything was inside that subfolder.
func RefineAuto(v *View, keys []uint64, rf Refine) ([]uint64, FolderFacet, []ExtCount, uint64) {
	out, ff, ec := ApplyRefine(v, keys, rf)
	for i := 0; i < 64 && len(ff.Folders) == 1 && ff.Here == 0 && ff.More == 0; i++ {
		k, _ := parseKey(ff.Folders[0].Key)
		if _, dir, _ := v.Node(k); !dir {
			break
		}
		next := rf
		next.Under = k
		o2, f2, e2 := ApplyRefine(v, keys, next)
		if len(o2) != len(out) || len(f2.Folders) == 0 && f2.Here == 0 {
			break
		}
		out, ff, ec, rf = o2, f2, e2, next
	}
	return out, ff, ec, rf.Under
}
