package main

// Portable indexer: walks folders one by one. Used when the fast NTFS reader
// is not available (no admin rights, non-NTFS drive, or not Windows).

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// walkInto adds everything under roots. Keys are base+1, base+2, ...; each
// index gets its own base (top byte) so keys never collide across indexes.
// Size and date come with the directory listing, so they are recorded too.
func walkInto(b *Builder, roots []string, base uint64, progress func(n int, where string)) error {
	next := base
	newKey := func() uint64 { next++; return next }
	var firstErr error
	last := time.Now()
	for _, root := range roots {
		root, _ = filepath.Abs(root)
		rk := newKey()
		disp := strings.TrimRight(root, `\/`)
		if disp == "" {
			disp = root
		}
		b.AddRoot(rk, disp)
		type item struct {
			path string
			key  uint64
		}
		stack := []item{{root, rk}}
		for len(stack) > 0 {
			it := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			ents, err := os.ReadDir(it.path)
			if err != nil {
				if it.key == rk && firstErr == nil {
					firstErr = err // the root itself is unreachable (e.g. network share offline)
				}
				continue
			}
			for _, e := range ents {
				k := newKey()
				isDir := e.IsDir() // symlinks/junctions are not followed
				b.Add(k, it.key, e.Name(), isDir)
				if info, err := e.Info(); err == nil {
					if isDir {
						b.AddMeta(k, -1, info.ModTime().Unix())
					} else {
						b.AddMeta(k, info.Size(), info.ModTime().Unix())
					}
				}
				if isDir {
					stack = append(stack, item{filepath.Join(it.path, e.Name()), k})
				}
			}
			if progress != nil && time.Since(last) > 250*time.Millisecond {
				last = time.Now()
				progress(b.Len(), it.path)
			}
		}
	}
	return firstErr
}
