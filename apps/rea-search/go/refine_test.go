package main

import (
	"strings"
	"testing"
)

func refineSample() *View {
	b := NewBuilder()
	b.AddRoot(1<<56|1, "C:")
	b.Add(1<<56|2, 1<<56|1, "업무", true)
	b.Add(1<<56|3, 1<<56|2, "2024", true)
	b.Add(1<<56|4, 1<<56|3, "예산.hwp", false)
	b.Add(1<<56|5, 1<<56|3, "예산.xlsx", false)
	b.Add(1<<56|6, 1<<56|2, "2025", true)
	b.Add(1<<56|7, 1<<56|6, "예산안.hwp", false)
	b.Add(1<<56|8, 1<<56|2, "예산 메모.txt", false)
	ix := b.Build(nil)
	return NewView([]*Index{ix}, []uint64{1})
}

func facetNames(ff FolderFacet) string {
	var s []string
	for _, f := range ff.Folders {
		s = append(s, f.Name+":"+itoa(uint64(f.Count)))
	}
	return strings.Join(s, " ")
}

func TestRefine(t *testing.T) {
	v := refineSample()
	keys := v.Search("예산")
	if len(keys) != 4 {
		t.Fatalf("search: %d", len(keys))
	}
	// everything is under C:\업무, so the panel opens there
	out, ff, ec, under := RefineAuto(v, keys, Refine{})
	if len(out) != 4 || under != 1<<56|2 {
		t.Fatalf("auto: %d results, under %x", len(out), under)
	}
	if got := facetNames(ff); got != "2024:2 2025:1" || ff.Here != 1 {
		t.Fatalf("folders %q here %d", got, ff.Here)
	}
	if len(ff.Crumbs) != 2 || ff.Crumbs[0].Name != "C:" || ff.Crumbs[1].Name != "업무" {
		t.Fatalf("crumbs %+v", ff.Crumbs)
	}
	if ec[0].Ext != "hwp" || ec[0].Count != 2 {
		t.Fatalf("exts %+v", ec)
	}
	// only 2024
	out, ff, _, _ = RefineAuto(v, keys, Refine{Under: 1<<56 | 3})
	if len(out) != 2 || ff.Here != 2 || len(ff.Folders) != 0 {
		t.Fatalf("under 2024: %d %+v", len(out), ff)
	}
	// only hwp: folder counts follow, extension counts do not
	out, ff, ec = ApplyRefine(v, keys, Refine{Under: 1<<56 | 2, Exts: []string{"hwp"}})
	if len(out) != 2 || facetNames(ff) != "2024:1 2025:1" || ff.Here != 0 || len(ec) != 3 {
		t.Fatalf("hwp: %d %q %d %+v", len(out), facetNames(ff), ff.Here, ec)
	}
}

func BenchmarkRefine(b *testing.B) {
	bl := NewBuilder()
	bl.AddRoot(1<<56, "C:")
	exts := strings.Fields("txt jpg png pdf docx mp3 mp4 exe dll py json log")
	for i := uint64(1); i < 1_000_000; i++ {
		bl.Add(1<<56|i, 1<<56|i/20, "f"+itoa(i)+"."+exts[i%11], i%12 == 0)
	}
	v := NewView([]*Index{bl.Build(func(uint64) (uint64, bool) { return 1 << 56, true })}, []uint64{1})
	keys := v.Search("")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		RefineAuto(v, keys, Refine{})
	}
}
