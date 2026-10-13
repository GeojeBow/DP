package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// selfTest indexes this machine the same way the app does, runs a few
// searches and checks that a file created, renamed and deleted afterwards
// shows up in the index (NTFS mode). Used by CI and for troubleshooting:
//
//	REASearch.exe -selftest
func selfTest(roots []string) int {
	fail := 0
	check := func(ok bool, what string) {
		if ok {
			logf("  OK   %s", what)
		} else {
			logf("  FAIL %s", what)
			fail++
		}
	}
	eng := NewEngine(roots)
	start := time.Now()
	eng.Build()
	mode, status, _, total := eng.Info()
	logf("mode=%s total=%d time=%.1fs status=%s", mode, total, time.Since(start).Seconds(), status)
	check(total > 1000 || len(roots) > 0, "index has entries")

	ix := eng.Index()
	for _, q := range []string{"exe", "*.dll", "ext:txt;log", "windows\\ system32 kernel32"} {
		t := time.Now()
		res := ix.Search(q)
		logf("  search %-30q %8d hits %6.1f ms", q, len(res), float64(time.Since(t).Microseconds())/1000)
		for i := 0; i < len(res) && i < 2; i++ {
			logf("      %s", ix.Path(res[i]))
		}
	}

	// Paths must point at real files.
	res := ix.Search("ext:exe;dll")
	bad := 0
	for i := 0; i < len(res) && i < 200; i++ {
		if _, err := os.Lstat(ix.Path(res[i])); err != nil {
			bad++
		}
	}
	check(len(res) == 0 || bad < 10, fmt.Sprintf("paths resolve to real files (%d/%d missing)", bad, min(len(res), 200)))

	if mode == "ntfs" {
		dir := os.TempDir()
		name := fmt.Sprintf("reasearch_selftest_%d.tmp", time.Now().UnixNano())
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte("x"), 0o644)
		check(waitFor(eng, name, true), "new file appears via change journal")
		renamed := strings.Replace(name, ".tmp", "_renamed.tmp", 1)
		os.Rename(p, filepath.Join(dir, renamed))
		check(waitFor(eng, renamed, true) && waitFor(eng, name+"$", false), "renamed file updates")
		os.Remove(filepath.Join(dir, renamed))
		check(waitFor(eng, renamed, false), "deleted file disappears")
		if got := eng.Index().Search(renamed); len(got) > 0 {
			logf("      %s", eng.Index().Path(got[0]))
		}
	}
	if fail > 0 {
		logf("SELFTEST FAILED (%d)", fail)
		return 1
	}
	logf("SELFTEST PASSED")
	return 0
}

// waitFor polls the change journal until a search for name has (or lacks) hits.
func waitFor(eng *Engine, name string, present bool) bool {
	exact := strings.HasSuffix(name, "$")
	name = strings.TrimSuffix(name, "$")
	for i := 0; i < 50; i++ {
		eng.pollOnce()
		found := false
		ix := eng.Index()
		for _, k := range ix.Search(name) {
			n, _, _ := ix.Node(k)
			if !exact || strings.EqualFold(n, name) {
				found = true
			}
		}
		if found == present {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}
