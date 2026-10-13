package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func sample() *Index {
	b := NewBuilder()
	b.AddRoot(1, "C:")
	b.Add(2, 1, "Documents", true)
	b.Add(3, 2, "Report 2026.docx", false)
	b.Add(4, 2, "report-final.PDF", false)
	b.Add(5, 1, "Pictures", true)
	b.Add(6, 5, "cat.jpg", false)
	b.Add(7, 5, "dog.png", false)
	b.Add(8, 2, "회의록_보고서.txt", false)
	return b.Build(nil)
}

func names(ix *Index, q string) []string {
	out := []string{}
	for _, k := range ix.Search(q) {
		n, _, _ := ix.Node(k)
		out = append(out, n)
	}
	return out
}

func eq(t *testing.T, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSearch(t *testing.T) {
	ix := sample()
	eq(t, names(ix, "report"), []string{"Report 2026.docx", "report-final.PDF"})
	eq(t, names(ix, "rep final"), []string{"report-final.PDF"})
	or := names(ix, "cat | dog")
	sort.Strings(or)
	eq(t, or, []string{"cat.jpg", "dog.png"})
	eq(t, names(ix, "report !pdf"), []string{"Report 2026.docx"})
	eq(t, names(ix, "*.jpg"), []string{"cat.jpg"})
	eq(t, names(ix, "d?g.*"), []string{"dog.png"})
	eq(t, names(ix, "ext:jpg;png"), []string{"cat.jpg", "dog.png"})
	eq(t, names(ix, "folder:"), []string{"C:", "Documents", "Pictures"})
	eq(t, names(ix, `pictures\ cat`), []string{"cat.jpg"})
	eq(t, names(ix, "보고서"), []string{"회의록_보고서.txt"})
	eq(t, names(ix, "회의?_*"), []string{"회의록_보고서.txt"})
	if n := len(ix.Search("")); n != ix.Len() {
		t.Fatalf("empty query: %d of %d", n, ix.Len())
	}
	if p := ix.Path(ix.Search("cat.jpg")[0]); p != `C:\Pictures\cat.jpg` {
		t.Fatalf("path %q", p)
	}
}

func TestLiveChanges(t *testing.T) {
	ix := sample()
	ix.Upsert(100, 5, "bird.gif", false)
	eq(t, names(ix, "bird"), []string{"bird.gif"})
	ix.Upsert(6, 5, "tiger.jpg", false) // rename
	eq(t, names(ix, "cat"), []string{})
	eq(t, names(ix, "tiger"), []string{"tiger.jpg"})
	ix.Upsert(5, 1, "Photos", true) // folder rename changes child paths
	if p := ix.Path(ix.Search("dog")[0]); p != `C:\Photos\dog.png` {
		t.Fatalf("path after folder rename %q", p)
	}
	ix.Remove(7)
	eq(t, names(ix, "dog"), []string{})
	c := ix.Compact()
	if c.OverlaySize() != 0 {
		t.Fatal("overlay not folded")
	}
	eq(t, names(c, "*.gif | tiger"), []string{"bird.gif", "tiger.jpg"})
}

func TestWalker(t *testing.T) {
	d := t.TempDir()
	os.MkdirAll(filepath.Join(d, "a", "b"), 0o755)
	os.WriteFile(filepath.Join(d, "a", "b", "hello.txt"), nil, 0o644)
	b := NewBuilder()
	walkInto(b, []string{d}, nil)
	ix := b.Build(nil)
	got := ix.Path(ix.Search("hello")[0])
	if got != filepath.Join(d, "a", "b", "hello.txt") {
		t.Fatalf("walker path %q", got)
	}
}

func BenchmarkSearch(b *testing.B) {
	bl := NewBuilder()
	bl.AddRoot(0, "C:")
	words := strings.Fields("report photo invoice project backup music video setup readme 회의록 보고서 사진 data config log test final draft")
	exts := strings.Fields("txt jpg png pdf docx mp3 mp4 exe dll py json log")
	for i := uint64(1); i < 1_000_000; i++ {
		bl.Add(i, i/20, words[i%17]+"-"+words[(i/7)%17]+"_"+itoa(i)+"."+exts[i%11], i%12 == 0)
	}
	ix := bl.Build(func(uint64) (uint64, bool) { return 0, true })
	b.ResetTimer()
	for _, q := range []string{"보고서", "invoice final", "*.mp4", "12345", "a"} {
		b.Run(q, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				ix.Search(q)
			}
		})
	}
}

func itoa(i uint64) string {
	s := ""
	for {
		s = string(rune('0'+i%10)) + s
		i /= 10
		if i == 0 {
			return s
		}
	}
}
