package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFilterTokens(t *testing.T) {
	now := time.Date(2026, 10, 13, 15, 0, 0, 0, time.Local)
	f := Filter{MinSize: -1, MaxSize: -1}
	q := extractFilterTokens("보고서 size:>10mb dm:2024 ext:pdf", &f, now)
	if q != "보고서 ext:pdf" || f.MinSize != 10<<20+1 || f.MaxSize != -1 {
		t.Fatalf("q=%q f=%+v", q, f)
	}
	if time.Unix(f.After, 0).Year() != 2024 || time.Unix(f.Before, 0).Year() != 2025 {
		t.Fatalf("year range %v %v", time.Unix(f.After, 0), time.Unix(f.Before, 0))
	}
	f = Filter{MinSize: -1, MaxSize: -1}
	q = extractFilterTokens("size:1kb..2kb dm:7d size:huge", &f, now)
	if q != "size:huge" || f.MinSize != 1024 || f.MaxSize != 2048 {
		t.Fatalf("q=%q f=%+v", q, f)
	}
	if got := time.Unix(f.After, 0); got.Day() != 7 || time.Unix(f.Before, 0).Day() != 14 {
		t.Fatalf("7d: %v .. %v", got, time.Unix(f.Before, 0))
	}
	f = Filter{MinSize: -1, MaxSize: -1}
	extractFilterTokens("dm:today 크기:0", &f, now)
	if f.MinSize != 0 || f.MaxSize != 0 || time.Unix(f.After, 0).Day() != 13 {
		t.Fatalf("today/empty: %+v", f)
	}
}

func TestFolderSizes(t *testing.T) {
	d := tree(t)
	v := walkView(t, d)
	sizes := v.FolderSizes()
	byName := map[string]FolderTotal{}
	for k, s := range sizes {
		byName[v.Path(k)] = s
	}
	if s := byName[filepath.Join(d, "pics")]; s.Bytes != 600 || s.Files != 2 || !s.Known {
		t.Fatalf("pics: %+v", s)
	}
	if s := byName[d]; s.Bytes != 10+5000+300+300+9000 || s.Files != 5 {
		t.Fatalf("root: %+v", s)
	}
}

func TestDuplicatesByContent(t *testing.T) {
	d := t.TempDir()
	big := strings.Repeat("a", 300<<10)
	diffEnd := big[:len(big)/2] + "b" + big[len(big)/2+1:] // same head and tail, different middle
	files := map[string]string{
		"one.txt": "hello", "two/renamed.txt": "hello", "three.txt": "hellp",
		"big1.bin": big, "big2.bin": big, "big3.bin": diffEnd,
	}
	for n, c := range files {
		p := filepath.Join(d, n)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(c), 0o644)
	}
	v := walkView(t, d)
	all := v.Search("")
	var prog DupProgress
	var stop atomic.Bool
	HashDuplicates(v, all, &prog, &stop)
	keys, groups := DuplicatesByContent(v, all)
	got := map[int][]string{}
	for _, k := range keys {
		n, _, _ := v.Node(k)
		got[groups[k]] = append(got[groups[k]], n)
	}
	if len(got) != 2 || strings.Join(got[1], ",") != "big1.bin,big2.bin" && strings.Join(got[1], ",") != "big2.bin,big1.bin" {
		t.Fatalf("groups %v", got)
	}
	if g := got[2]; len(g) != 2 {
		t.Fatalf("small group %v", got)
	}
}

func TestCIndexReportsFailures(t *testing.T) {
	d := t.TempDir()
	os.WriteFile(filepath.Join(d, "ok.txt"), []byte("회의 예산"), 0o644)
	os.WriteFile(filepath.Join(d, "bad.pdf"), []byte("%PDF-1.4 garbage"), 0o644)
	os.WriteFile(filepath.Join(d, "bad.docx"), []byte("not a zip"), 0o644)
	c := OpenCIndex(t.TempDir())
	t.Cleanup(c.Close)
	if err := c.AddFolder(d); err != nil {
		t.Fatal(err)
	}
	waitIdle(c)
	c.Refresh(true) // in case the background refresh had not started yet
	r := c.Report()
	if r.Failed != 2 || r.Checked != 3 || r.LastRun == 0 {
		t.Fatalf("report %+v", r)
	}
	if r.Reasons["글자가 없는 PDF (스캔한 이미지일 수 있음)"] != 1 {
		t.Fatalf("reasons %v", r.Reasons)
	}
	// a damaged file must not crash the reader
	if _, err := ExtractText(filepath.Join(d, "bad.pdf")); err == nil {
		t.Fatal("expected an error")
	}
}
