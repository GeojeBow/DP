package main

// Portable indexer: walks folders one by one. Used when the fast NTFS reader
// is not available (no admin rights, non-NTFS drive, or not Windows).

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

func walkInto(b *Builder, roots []string, progress func(n int, where string)) {
	var next uint64 = 1 << 62 // keep walker keys apart from NTFS keys
	newKey := func() uint64 { next++; return next }
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
				continue
			}
			for _, e := range ents {
				k := newKey()
				isDir := e.IsDir() // symlinks/junctions are not followed
				b.Add(k, it.key, e.Name(), isDir)
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
}
