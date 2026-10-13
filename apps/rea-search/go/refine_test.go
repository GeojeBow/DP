package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestSlice(t *testing.T) {
	v := refineSample()
	keys := v.Search("예산")
	if len(keys) != 4 {
		t.Fatalf("search: %d", len(keys))
	}
	// everything is under C:\업무, so the folder panel opens there
	out, fac := SliceAuto(v, keys, noSlice())
	if len(out) != 4 || fac.Under != keyStr(1<<56|2) {
		t.Fatalf("auto: %d results, under %s", len(out), fac.Under)
	}
	if got := facetNames(fac.Folder); got != "2024:2 2025:1" || fac.Folder.Here != 1 {
		t.Fatalf("folders %q here %d", got, fac.Folder.Here)
	}
	if len(fac.Folder.Crumbs) != 2 || fac.Folder.Crumbs[0].Name != "C:" || fac.Folder.Crumbs[1].Name != "업무" {
		t.Fatalf("crumbs %+v", fac.Folder.Crumbs)
	}
	if fac.Exts[0].Ext != "hwp" || fac.Exts[0].Count != 2 || fac.Cats["doc"] != 4 {
		t.Fatalf("exts %+v cats %v", fac.Exts, fac.Cats)
	}
	// only 2024
	sl := noSlice()
	sl.Under = 1<<56 | 3
	out, fac = SliceAuto(v, keys, sl)
	if len(out) != 2 || fac.Folder.Here != 2 || len(fac.Folder.Folders) != 0 {
		t.Fatalf("under 2024: %d %+v", len(out), fac.Folder)
	}
	// only hwp: folder counts follow, extension counts do not
	sl = noSlice()
	sl.Under, sl.Exts = 1<<56|2, []string{"hwp"}
	out, fac = ApplySlice(v, keys, sl, true)
	if len(out) != 2 || facetNames(fac.Folder) != "2024:1 2025:1" || fac.Folder.Here != 0 || len(fac.Exts) != 3 {
		t.Fatalf("hwp: %d %q %d %+v", len(out), facetNames(fac.Folder), fac.Folder.Here, fac.Exts)
	}
	// words within the results, and excluding one
	sl = noSlice()
	sl.Within = "예산 !메모"
	if out, _ = ApplySlice(v, keys, sl, false); len(out) != 3 {
		t.Fatalf("within: %d", len(out))
	}
	sl.Within = `2025\`
	if out, _ = ApplySlice(v, keys, sl, false); len(out) != 1 {
		t.Fatalf("within path: %d", len(out))
	}
	// group by folder keeps each folder together
	g, groups, gk := GroupBy(v, keys, "ext")
	if len(groups) != 3 || groups[0].Key != "hwp" || groups[0].Count != 2 || gk[g[0]] != "hwp" || gk[g[1]] != "hwp" {
		t.Fatalf("group: %+v", groups)
	}
}

func TestSliceDateSize(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, size int, age time.Duration) {
		p := filepath.Join(dir, name)
		os.WriteFile(p, make([]byte, size), 0o644)
		tm := time.Now().Add(-age)
		os.Chtimes(p, tm, tm)
	}
	write("new.txt", 10, 0)
	write("old.txt", 200<<10, 3*365*24*time.Hour)
	write("empty.txt", 0, 0)
	b := NewBuilder()
	if err := walkInto(b, []string{dir}, 1<<56, nil); err != nil {
		t.Fatal(err)
	}
	v := NewView([]*Index{b.Build(nil)}, []uint64{1})
	keys := v.Search("txt")
	_, fac := ApplySlice(v, keys, noSlice(), true)
	count := func(list []RangeCount, id string) int {
		for _, r := range list {
			if r.ID == id {
				return r.Count
			}
		}
		return -1
	}
	if !fac.MetaKnown || count(fac.Dates, "today") != 2 || count(fac.Dates, "old") != 1 || count(fac.Sizes, "zero") != 1 || count(fac.Sizes, "small") != 1 {
		t.Fatalf("dates %+v sizes %+v", fac.Dates, fac.Sizes)
	}
	sl := noSlice()
	sl.MinSize = 1
	if out, _ := ApplySlice(v, keys, sl, false); len(out) != 2 {
		t.Fatalf("min size: %d", len(out))
	}
	_, groups, _ := GroupBy(v, keys, "date")
	if len(groups) != 2 || groups[0].Key != "today" || groups[1].Key != "older" {
		t.Fatalf("date groups %+v", groups)
	}
}

// The side panel lists the folders that directly hold results, by count.
func TestSliceParents(t *testing.T) {
	dir := t.TempDir()
	for _, p := range []string{"a/x/r1.txt", "a/x/r2.txt", "a/y/r3.txt", "b/r4.txt", "b/other.md"} {
		f := filepath.Join(dir, filepath.FromSlash(p))
		os.MkdirAll(filepath.Dir(f), 0o755)
		os.WriteFile(f, nil, 0o644)
	}
	b := NewBuilder()
	if err := walkInto(b, []string{dir}, 1<<56, nil); err != nil {
		t.Fatal(err)
	}
	v := NewView([]*Index{b.Build(nil)}, []uint64{1})
	_, fac := ApplySlice(v, v.Search("r .txt"), noSlice(), true)
	var got []string
	for _, f := range fac.Parents {
		got = append(got, fmt.Sprintf("%s=%d", filepath.Base(f.Name), f.Count))
	}
	if strings.Join(got, " ") != "x=2 y=1 b=1" {
		t.Fatalf("parents %v", got)
	}
	// narrowed to a: only a's folders remain
	k, _ := parseKey(fac.Parents[0].Key)
	par, _ := v.Parent(k)
	sl := noSlice()
	sl.Under = par
	_, fac = ApplySlice(v, v.Search("r .txt"), sl, true)
	if len(fac.Parents) != 2 || fac.Total != 3 {
		t.Fatalf("under a: %+v total %d", fac.Parents, fac.Total)
	}
}

func BenchmarkSlice(b *testing.B) {
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
		sl := noSlice()
		sl.Cats = []string{"doc"}
		ApplySlice(v, keys, sl, false)
	}
}
