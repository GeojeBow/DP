package main

// Duplicate files by content: files of equal size are compared by a hash of
// their first and last 64 KB, and those still equal by a hash of the whole
// file. Hashes are remembered (by key, size and date) so a second look is
// instant.

import (
	"crypto/sha256"
	"io"
	"os"
	"sort"
	"sync"
	"sync/atomic"
)

type fileHash struct {
	size, mod        int64
	part, whole      [16]byte
	hasPart, hasFull bool
}

type hashCache struct {
	mu sync.RWMutex
	m  map[uint64]fileHash
}

var hashes = &hashCache{m: map[uint64]fileHash{}}

// get returns the head-and-tail hash (full false) or whole-file hash. For
// small files the two are the same.
func (h *hashCache) get(k uint64, m meta, full bool) ([16]byte, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	e, ok := h.m[k]
	if !ok || e.size != m.size || e.mod != m.mod {
		return [16]byte{}, false
	}
	if full || m.size <= 2*partSize {
		return e.whole, e.hasFull
	}
	return e.part, e.hasPart
}

func (h *hashCache) put(k uint64, m meta, full bool, sum [16]byte) {
	h.mu.Lock()
	e := h.m[k]
	if e.size != m.size || e.mod != m.mod {
		e = fileHash{size: m.size, mod: m.mod}
	}
	if full || m.size <= 2*partSize {
		e.whole, e.hasFull = sum, true
	}
	if !full {
		e.part, e.hasPart = sum, true
	}
	h.m[k] = e
	h.mu.Unlock()
}

const partSize = 64 << 10

func hashFile(p string, size int64, full bool, done *atomic.Int64) ([16]byte, error) {
	var out [16]byte
	f, err := os.Open(p)
	if err != nil {
		return out, err
	}
	defer f.Close()
	h := sha256.New()
	if full || size <= 2*partSize {
		buf := make([]byte, 1<<20)
		for {
			n, err := f.Read(buf)
			h.Write(buf[:n])
			done.Add(int64(n))
			if err == io.EOF {
				break
			}
			if err != nil {
				return out, err
			}
		}
	} else {
		buf := make([]byte, partSize)
		if _, err := io.ReadFull(f, buf); err != nil {
			return out, err
		}
		h.Write(buf)
		if _, err := f.ReadAt(buf, size-partSize); err != nil && err != io.EOF {
			return out, err
		}
		h.Write(buf)
		done.Add(2 * partSize)
	}
	copy(out[:], h.Sum(nil))
	return out, nil
}

// DupProgress is reported while comparing contents.
type DupProgress struct {
	Pass             atomic.Int64 // 1 head and tail, 2 whole files
	Files, FilesDone atomic.Int64
	Bytes, BytesDone atomic.Int64
	Failed           atomic.Int64
}

// HashDuplicates hashes every file in keys that shares its size with
// another, so DuplicatesByContent can group them. stop is checked between
// files.
func HashDuplicates(v *View, keys []uint64, prog *DupProgress, stop *atomic.Bool) {
	var files []uint64
	for _, k := range keys {
		if _, dir, ok := v.Node(k); ok && !dir {
			files = append(files, k)
		}
		if len(files) >= MetaLimit {
			break
		}
	}
	v.EnsureMeta(files, nil)
	bySize := map[int64][]uint64{}
	for _, k := range files {
		if m, ok := v.Meta(k); ok && m.ok && m.size > 0 {
			bySize[m.size] = append(bySize[m.size], k)
		}
	}
	var groups [][]uint64
	for _, g := range bySize {
		if len(g) > 1 {
			groups = append(groups, g)
		}
	}
	// pass 1: head and tail; pass 2: whole file for those still matching
	for pass := 0; pass < 2 && !stop.Load(); pass++ {
		full := pass == 1
		var todo []uint64
		for _, g := range groups {
			todo = append(todo, g...)
		}
		cost := func(size int64) int64 {
			if full || size <= 2*partSize {
				return size
			}
			return 2 * partSize
		}
		var total int64
		for _, k := range todo {
			m, _ := v.Meta(k)
			total += cost(m.size)
		}
		prog.Pass.Store(int64(pass + 1))
		prog.Files.Store(int64(len(todo)))
		prog.FilesDone.Store(0)
		prog.Bytes.Store(total)
		prog.BytesDone.Store(0)
		var mu sync.Mutex
		sums := map[uint64][16]byte{}
		ch := make(chan uint64)
		var wg sync.WaitGroup
		for w := 0; w < 4; w++ { // disks dislike many parallel readers
			wg.Add(1)
			go func() {
				defer wg.Done()
				for k := range ch {
					m, _ := v.Meta(k)
					sum, ok := hashes.get(k, m, full)
					if !ok {
						var err error
						sum, err = hashFile(v.Path(k), m.size, full, &prog.BytesDone)
						if err != nil {
							prog.Failed.Add(1)
							prog.FilesDone.Add(1)
							continue
						}
						hashes.put(k, m, full, sum)
					} else {
						prog.BytesDone.Add(cost(m.size))
					}
					mu.Lock()
					sums[k] = sum
					mu.Unlock()
					prog.FilesDone.Add(1)
				}
			}()
		}
		for _, k := range todo {
			if stop.Load() {
				break
			}
			ch <- k
		}
		close(ch)
		wg.Wait()
		// regroup by (size, hash) and keep groups that still collide
		type gk struct {
			size int64
			sum  [16]byte
		}
		next := map[gk][]uint64{}
		for _, k := range todo {
			if s, ok := sums[k]; ok {
				m, _ := v.Meta(k)
				next[gk{m.size, s}] = append(next[gk{m.size, s}], k)
			}
		}
		groups = groups[:0]
		for g, ks := range next {
			if len(ks) > 1 && g.size > 2*partSize { // small files were hashed whole already
				groups = append(groups, ks)
			}
		}
	}
}

// DuplicatesByContent groups files whose whole-file hash is known and equal,
// biggest wasted space first. Files not hashed yet are left out.
func DuplicatesByContent(v *View, keys []uint64) ([]uint64, map[uint64]int) {
	type gk struct {
		size int64
		sum  [16]byte
	}
	groups := map[gk][]uint64{}
	for _, k := range keys {
		m, ok := v.Meta(k)
		if !ok || !m.ok || m.size <= 0 {
			continue
		}
		if sum, ok := hashes.get(k, m, true); ok {
			groups[gk{m.size, sum}] = append(groups[gk{m.size, sum}], k)
		}
	}
	var order []gk
	for g, ks := range groups {
		if len(ks) > 1 {
			order = append(order, g)
		}
	}
	sort.Slice(order, func(i, j int) bool {
		a, b := order[i], order[j]
		wa, wb := a.size*int64(len(groups[a])-1), b.size*int64(len(groups[b])-1)
		if wa != wb {
			return wa > wb
		}
		return string(a.sum[:]) < string(b.sum[:])
	})
	var out []uint64
	gid := map[uint64]int{}
	for n, g := range order {
		for _, k := range groups[g] {
			out = append(out, k)
			gid[k] = n + 1
		}
	}
	return out, gid
}
