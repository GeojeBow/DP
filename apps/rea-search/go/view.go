package main

// A View is the set of indexes being searched together: the NTFS drives
// (or local folders walked without admin rights) plus one index per extra
// folder such as a network share. Each index owns a key range (the top
// byte of the key), so any key can be routed back to its index.

import (
	"os"
	"runtime"
	"strings"
	"sync"
)

type View struct {
	srcs  []*Index
	route map[uint64]*Index // key >> 56 -> index
}

func NewView(srcs []*Index, tops []uint64) *View {
	v := &View{srcs: srcs, route: map[uint64]*Index{}}
	for i, ix := range srcs {
		v.route[tops[i]] = ix
	}
	return v
}

func (v *View) of(k uint64) *Index {
	if ix, ok := v.route[k>>56]; ok {
		return ix
	}
	return emptyIndex
}

var emptyIndex = NewBuilder().Build(nil)

func (v *View) Node(k uint64) (string, bool, bool) { return v.of(k).Node(k) }
func (v *View) Path(k uint64) string               { return v.of(k).Path(k) }
func (v *View) Folder(k uint64) string             { return v.of(k).Folder(k) }
func (v *View) Exists(k uint64) bool               { return v.of(k).Exists(k) }
func (v *View) Meta(k uint64) (meta, bool)         { return v.of(k).Meta(k) }

func (v *View) Len() int {
	n := 0
	for _, ix := range v.srcs {
		n += ix.Len()
	}
	return n
}

func (v *View) Search(text string) []uint64 { return v.SearchOpts(text, NameOpts{}) }

// SearchOpts searches every index in parallel and merges the name-sorted
// result lists.
func (v *View) SearchOpts(text string, o NameOpts) []uint64 {
	if len(v.srcs) == 1 {
		return v.srcs[0].SearchOpts(text, o)
	}
	parts := make([][]uint64, len(v.srcs))
	var wg sync.WaitGroup
	for i, ix := range v.srcs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			parts[i] = ix.SearchOpts(text, o)
		}()
	}
	wg.Wait()
	total := 0
	for _, p := range parts {
		total += len(p)
	}
	out := make([]uint64, 0, total)
	idx := make([]int, len(parts))
	heads := make([]string, len(parts))
	for i := range parts {
		if len(parts[i]) > 0 {
			heads[i] = v.srcs[i].Lower(parts[i][0])
		}
	}
	for len(out) < total {
		best := -1
		for i := range parts {
			if idx[i] < len(parts[i]) && (best < 0 || heads[i] < heads[best]) {
				best = i
			}
		}
		out = append(out, parts[best][idx[best]])
		idx[best]++
		if idx[best] < len(parts[best]) {
			heads[best] = v.srcs[best].Lower(parts[best][idx[best]])
		}
	}
	return out
}

// EnsureMeta reads size/date for keys that have none yet, with many
// goroutines since stat calls wait on the disk or network.
func (v *View) EnsureMeta(keys []uint64, progress func(done, total int)) {
	var todo []uint64
	for _, k := range keys {
		if _, ok := v.Meta(k); !ok {
			todo = append(todo, k)
		}
	}
	if len(todo) == 0 {
		return
	}
	workers := runtime.NumCPU() * 4
	ch := make(chan uint64, 1024)
	var wg sync.WaitGroup
	var dmu sync.Mutex
	done := 0
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			batch := map[uint64]meta{}
			flush := func() {
				byIx := map[*Index]map[uint64]meta{}
				for k, m := range batch {
					ix := v.of(k)
					if byIx[ix] == nil {
						byIx[ix] = map[uint64]meta{}
					}
					byIx[ix][k] = m
				}
				for ix, b := range byIx {
					ix.setMeta(b)
				}
				dmu.Lock()
				done += len(batch)
				d := done
				dmu.Unlock()
				if progress != nil {
					progress(d, len(todo))
				}
				batch = map[uint64]meta{}
			}
			for k := range ch {
				var m meta
				if st, err := os.Lstat(v.Path(k)); err == nil {
					m = meta{size: st.Size(), mod: st.ModTime().Unix(), ok: true}
					if st.IsDir() {
						m.size = -1
					}
				}
				batch[k] = m
				if len(batch) >= 2000 {
					flush()
				}
			}
			flush()
		}()
	}
	for _, k := range todo {
		ch <- k
	}
	close(ch)
	wg.Wait()
}

// Lower returns the lower-cased name used for ordering.
func (ix *Index) Lower(key uint64) string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	if r, ok := ix.extra[key]; ok {
		return strings.ToLower(r.name)
	}
	if i := ix.pos(key); i >= 0 {
		return ix.lower(i)
	}
	return ""
}
