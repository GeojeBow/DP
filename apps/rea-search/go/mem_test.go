package main

import (
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// TestMemoryScale builds a large synthetic index and reports memory and
// search time. Run with REA_SCALE=5000000 go test -run MemoryScale -v
func TestMemoryScale(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("REA_SCALE"))
	if n == 0 {
		t.Skip("set REA_SCALE to run")
	}
	words := []string{"report", "photo", "invoice", "project", "backup", "회의록", "보고서", "사진", "data", "final", "draft", "설계도면", "견적서"}
	exts := []string{"txt", "jpg", "png", "pdf", "docx", "xlsx", "hwp", "dwg", "mp4", "zip"}
	start := time.Now()
	b := NewBuilder()
	b.AddRoot(0, "C:")
	for i := 1; i < n; i++ {
		name := words[i%13] + "_" + words[(i/13)%13] + "_" + strconv.Itoa(i) + "." + exts[i%10]
		b.Add(uint64(i), uint64(i/30), name, i%10 == 0)
	}
	ix := b.Build(nil)
	b = nil
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	t.Logf("%d entries built in %.1fs, heap in use %.0f MB", n, time.Since(start).Seconds(), float64(ms.HeapInuse)/1e6)
	for _, q := range []string{"보고서", "final 견적서", "*.dwg", "12345", "ext:hwp;pdf 설계"} {
		s := time.Now()
		r := ix.Search(q)
		t.Logf("  %-18s %9d hits %7.1f ms", q, len(r), float64(time.Since(s).Microseconds())/1000)
	}
	s := time.Now()
	st := ix.State()
	if err := writeGob(t.TempDir()+"/c.gob", st); err != nil {
		t.Fatal(err)
	}
	t.Logf("  cache save %.1fs", time.Since(s).Seconds())
}
